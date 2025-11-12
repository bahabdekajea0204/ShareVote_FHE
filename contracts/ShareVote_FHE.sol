pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ShareVote_FHE is ZamaEthereumConfig {
    struct Proposal {
        string title;
        string description;
        uint256 endTime;
        bool isActive;
        euint32 encryptedTotalVotes;
        uint32 decryptedTotalVotes;
        bool isTallied;
    }

    struct Vote {
        address voter;
        euint32 encryptedVoteWeight;
        uint256 timestamp;
        bool exists;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => Vote)) public votes;
    mapping(address => bool) public shareholders;
    mapping(address => euint32) public encryptedVoteWeights;

    address public admin;
    uint256 public proposalCount;
    uint256 public constant MAX_VOTE_WEIGHT = 1000;

    event ProposalCreated(uint256 indexed proposalId, string title);
    event VoteCast(uint256 indexed proposalId, address indexed voter);
    event VotesTallied(uint256 indexed proposalId, uint32 result);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can perform this action");
        _;
    }

    modifier onlyShareholder() {
        require(shareholders[msg.sender], "Only shareholders can vote");
        _;
    }

    constructor() ZamaEthereumConfig() {
        admin = msg.sender;
    }

    function addShareholder(address shareholder, externalEuint32 encryptedWeight, bytes calldata proof) external onlyAdmin {
        require(!shareholders[shareholder], "Shareholder already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedWeight, proof)), "Invalid encrypted weight");
        require(FHE.leq(FHE.fromExternal(encryptedWeight, proof), MAX_VOTE_WEIGHT), "Vote weight exceeds maximum");

        encryptedVoteWeights[shareholder] = FHE.fromExternal(encryptedWeight, proof);
        shareholders[shareholder] = true;
        FHE.allowThis(encryptedVoteWeights[shareholder]);
    }

    function createProposal(
        string calldata title, 
        string calldata description, 
        uint256 duration
    ) external onlyAdmin {
        uint256 endTime = block.timestamp + duration;
        proposalCount++;

        proposals[proposalCount] = Proposal({
            title: title,
            description: description,
            endTime: endTime,
            isActive: true,
            encryptedTotalVotes: FHE.zero(),
            decryptedTotalVotes: 0,
            isTallied: false
        });

        FHE.allowThis(proposals[proposalCount].encryptedTotalVotes);
        emit ProposalCreated(proposalCount, title);
    }

    function castVote(
        uint256 proposalId, 
        externalEuint32 encryptedVote, 
        bytes calldata proof
    ) external onlyShareholder {
        require(proposals[proposalId].isActive, "Voting is closed");
        require(block.timestamp <= proposals[proposalId].endTime, "Voting period has ended");
        require(!votes[proposalId][msg.sender].exists, "Already voted");

        euint32 encryptedVoteWeight = FHE.fromExternal(encryptedVote, proof);
        require(FHE.eq(encryptedVoteWeight, encryptedVoteWeights[msg.sender]), "Invalid vote weight");

        proposals[proposalId].encryptedTotalVotes = FHE.add(
            proposals[proposalId].encryptedTotalVotes, 
            encryptedVoteWeight
        );

        votes[proposalId][msg.sender] = Vote({
            voter: msg.sender,
            encryptedVoteWeight: encryptedVoteWeight,
            timestamp: block.timestamp,
            exists: true
        });

        emit VoteCast(proposalId, msg.sender);
    }

    function tallyVotes(
        uint256 proposalId, 
        bytes memory abiEncodedClearValue, 
        bytes memory decryptionProof
    ) external onlyAdmin {
        require(!proposals[proposalId].isTallied, "Votes already tallied");
        require(block.timestamp > proposals[proposalId].endTime, "Voting still in progress");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(proposals[proposalId].encryptedTotalVotes);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        uint32 decryptedTotal = abi.decode(abiEncodedClearValue, (uint32));

        proposals[proposalId].decryptedTotalVotes = decryptedTotal;
        proposals[proposalId].isTallied = true;
        proposals[proposalId].isActive = false;

        emit VotesTallied(proposalId, decryptedTotal);
    }

    function getVoteWeight(address shareholder) external view returns (euint32) {
        require(shareholders[shareholder], "Not a shareholder");
        return encryptedVoteWeights[shareholder];
    }

    function getProposal(uint256 proposalId) external view returns (
        string memory title,
        string memory description,
        uint256 endTime,
        bool isActive,
        uint32 decryptedTotalVotes,
        bool isTallied
    ) {
        require(proposalId <= proposalCount, "Invalid proposal ID");
        Proposal storage p = proposals[proposalId];
        return (p.title, p.description, p.endTime, p.isActive, p.decryptedTotalVotes, p.isTallied);
    }

    function getVote(uint256 proposalId, address voter) external view returns (
        euint32 encryptedVoteWeight,
        uint256 timestamp,
        bool exists
    ) {
        require(proposalId <= proposalCount, "Invalid proposal ID");
        require(shareholders[voter], "Not a shareholder");
        Vote storage v = votes[proposalId][voter];
        return (v.encryptedVoteWeight, v.timestamp, v.exists);
    }

    function getTotalProposals() external view returns (uint256) {
        return proposalCount;
    }
}

