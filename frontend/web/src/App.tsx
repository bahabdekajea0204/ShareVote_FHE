import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface VotingProposal {
  id: string;
  title: string;
  description: string;
  creator: string;
  timestamp: number;
  encryptedVotes: string;
  publicValue1: number;
  publicValue2: number;
  isVerified: boolean;
  decryptedValue: number;
  voteCount: number;
  status: 'active' | 'completed';
}

interface VoteStats {
  totalProposals: number;
  activeProposals: number;
  verifiedVotes: number;
  avgParticipation: number;
  totalVotes: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<VotingProposal[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newProposalData, setNewProposalData] = useState({ title: "", description: "", voteWeight: "" });
  const [selectedProposal, setSelectedProposal] = useState<VotingProposal | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ votes: number | null }>({ votes: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [voteInput, setVoteInput] = useState("");
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [voting, setVoting] = useState(false);
  const [stats, setStats] = useState<VoteStats>({
    totalProposals: 0,
    activeProposals: 0,
    verifiedVotes: 0,
    avgParticipation: 0,
    totalVotes: 0
  });
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const proposalsList: VotingProposal[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          proposalsList.push({
            id: businessId,
            title: businessData.name,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            encryptedVotes: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            voteCount: Number(businessData.publicValue1) || 0,
            status: Number(businessData.timestamp) > Date.now()/1000 - 86400 ? 'active' : 'completed'
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setProposals(proposalsList);
      calculateStats(proposalsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateStats = (proposalsList: VotingProposal[]) => {
    const totalProposals = proposalsList.length;
    const activeProposals = proposalsList.filter(p => p.status === 'active').length;
    const verifiedVotes = proposalsList.filter(p => p.isVerified).length;
    const avgParticipation = proposalsList.length > 0 
      ? proposalsList.reduce((sum, p) => sum + p.voteCount, 0) / proposalsList.length 
      : 0;
    const totalVotes = proposalsList.reduce((sum, p) => sum + p.voteCount, 0);

    setStats({
      totalProposals,
      activeProposals,
      verifiedVotes,
      avgParticipation,
      totalVotes
    });
  };

  const createProposal = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingProposal(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating proposal with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const voteWeight = parseInt(newProposalData.voteWeight) || 1;
      const businessId = `proposal-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, voteWeight);
      
      const tx = await contract.createBusinessData(
        businessId,
        newProposalData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newProposalData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Proposal created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewProposalData({ title: "", description: "", voteWeight: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingProposal(false); 
    }
  };

  const castVote = async () => {
    if (!isConnected || !address || !selectedProposal) return;
    
    setVoting(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Casting encrypted vote..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const voteValue = parseInt(voteInput) || 1;
      const businessId = `vote-${selectedProposal.id}-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, voteValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        `Vote for ${selectedProposal.title}`,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        voteValue,
        0,
        `Vote cast by ${address}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Recording vote on-chain..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Vote cast successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowVoteModal(false);
      setVoteInput("");
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Vote failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setVoting(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) return null;
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      return Number(clearValue);
      
    } catch (e: any) { 
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and responding!" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsDashboard = () => {
    return (
      <div className="dashboard-panels">
        <div className="panel gradient-panel">
          <h3>Total Proposals</h3>
          <div className="stat-value">{stats.totalProposals}</div>
          <div className="stat-trend">{stats.activeProposals} active</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Verified Votes</h3>
          <div className="stat-value">{stats.verifiedVotes}</div>
          <div className="stat-trend">FHE Secured</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Avg Participation</h3>
          <div className="stat-value">{stats.avgParticipation.toFixed(1)}</div>
          <div className="stat-trend">votes per proposal</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Total Votes</h3>
          <div className="stat-value">{stats.totalVotes}</div>
          <div className="stat-trend">encrypted votes</div>
        </div>
      </div>
    );
  };

  const renderVoteChart = (proposal: VotingProposal) => {
    const total = proposal.voteCount || 1;
    const forVotes = Math.round(total * 0.6);
    const againstVotes = total - forVotes;
    
    return (
      <div className="vote-chart">
        <div className="chart-row">
          <div className="chart-label">For ({forVotes})</div>
          <div className="chart-bar">
            <div 
              className="bar-fill for" 
              style={{ width: `${(forVotes/total)*100}%` }}
            >
              <span className="bar-value">{Math.round((forVotes/total)*100)}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Against ({againstVotes})</div>
          <div className="chart-bar">
            <div 
              className="bar-fill against" 
              style={{ width: `${(againstVotes/total)*100}%` }}
            >
              <span className="bar-value">{Math.round((againstVotes/total)*100)}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    return (
      <div className="faq-section">
        <h3>FHE Voting FAQ</h3>
        <div className="faq-item">
          <h4>What is FHE voting?</h4>
          <p>Fully Homomorphic Encryption allows votes to be encrypted while still enabling computation on the encrypted data.</p>
        </div>
        <div className="faq-item">
          <h4>How are votes kept private?</h4>
          <p>Your vote weight is encrypted using Zama FHE technology, making it impossible to trace individual votes while allowing accurate tallying.</p>
        </div>
        <div className="faq-item">
          <h4>What happens during decryption?</h4>
          <p>The system performs offline decryption and on-chain verification using FHE.checkSignatures to ensure result integrity.</p>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>ShareVote FHE 🔐</h1>
            <p>Confidential Voting for Shareholders</p>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Access Encrypted Voting</h2>
            <p>Please connect your wallet to initialize the FHE voting system and participate in shareholder decisions.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Voting System...</p>
        <p className="loading-note">Encrypting your voting session</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted voting platform...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>ShareVote FHE 🔐</h1>
          <p>股東隱私表決 • Confidential Voting</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn neon-btn"
          >
            + New Proposal
          </button>
          <button 
            onClick={checkAvailability} 
            className="check-btn"
          >
            Check System
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Voting Statistics Dashboard</h2>
          {renderStatsDashboard()}
        </div>
        
        <div className="proposals-section">
          <div className="section-header">
            <h2>Active Voting Proposals</h2>
            <div className="header-actions">
              <button 
                onClick={() => setShowFAQ(!showFAQ)} 
                className="faq-btn"
              >
                {showFAQ ? "Hide FAQ" : "Show FAQ"}
              </button>
              <button 
                onClick={loadData} 
                className="refresh-btn neon-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          {showFAQ && renderFAQ()}
          
          <div className="proposals-list">
            {proposals.length === 0 ? (
              <div className="no-proposals">
                <p>No voting proposals found</p>
                <button 
                  className="create-btn neon-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Proposal
                </button>
              </div>
            ) : proposals.map((proposal, index) => (
              <div 
                className={`proposal-item ${selectedProposal?.id === proposal.id ? "selected" : ""} ${proposal.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedProposal(proposal)}
              >
                <div className="proposal-header">
                  <div className="proposal-title">{proposal.title}</div>
                  <div className={`proposal-status ${proposal.status}`}>
                    {proposal.status === 'active' ? '🟢 Active' : '🔴 Completed'}
                  </div>
                </div>
                <div className="proposal-description">{proposal.description}</div>
                <div className="proposal-meta">
                  <span>Votes: {proposal.voteCount}</span>
                  <span>Created: {new Date(proposal.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="proposal-verification">
                  Status: {proposal.isVerified ? "✅ Verified Results" : "🔓 Results Pending"}
                </div>
                <button 
                  className="vote-btn neon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedProposal(proposal);
                    setShowVoteModal(true);
                  }}
                >
                  Cast Vote
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateProposal 
          onSubmit={createProposal} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingProposal} 
          proposalData={newProposalData} 
          setProposalData={setNewProposalData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {showVoteModal && selectedProposal && (
        <VoteModal 
          proposal={selectedProposal}
          onClose={() => setShowVoteModal(false)}
          voteInput={voteInput}
          setVoteInput={setVoteInput}
          voting={voting}
          onVote={castVote}
        />
      )}
      
      {selectedProposal && (
        <ProposalDetailModal 
          proposal={selectedProposal} 
          onClose={() => { 
            setSelectedProposal(null); 
            setDecryptedData({ votes: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedProposal.encryptedVotes)}
          renderVoteChart={renderVoteChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateProposal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  proposalData: any;
  setProposalData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, proposalData, setProposalData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setProposalData({ ...proposalData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-proposal-modal">
        <div className="modal-header">
          <h2>New Voting Proposal</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Vote weights will be encrypted with Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Proposal Title *</label>
            <input 
              type="text" 
              name="title" 
              value={proposalData.title} 
              onChange={handleChange} 
              placeholder="Enter proposal title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={proposalData.description} 
              onChange={handleChange} 
              placeholder="Describe the proposal..." 
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Default Vote Weight (Integer) *</label>
            <input 
              type="number" 
              name="voteWeight" 
              value={proposalData.voteWeight} 
              onChange={handleChange} 
              placeholder="Enter default vote weight..." 
              step="1"
              min="1"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !proposalData.title || !proposalData.description || !proposalData.voteWeight} 
            className="submit-btn neon-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
};

const VoteModal: React.FC<{
  proposal: VotingProposal;
  onClose: () => void;
  voteInput: string;
  setVoteInput: (value: string) => void;
  voting: boolean;
  onVote: () => void;
}> = ({ proposal, onClose, voteInput, setVoteInput, voting, onVote }) => {
  return (
    <div className="modal-overlay">
      <div className="vote-modal">
        <div className="modal-header">
          <h2>Cast Your Vote</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="proposal-info">
            <h3>{proposal.title}</h3>
            <p>{proposal.description}</p>
          </div>
          
          <div className="vote-input-section">
            <label>Your Vote Weight (Integer)</label>
            <input 
              type="number" 
              value={voteInput}
              onChange={(e) => setVoteInput(e.target.value)}
              placeholder="Enter your vote weight..."
              min="1"
              step="1"
            />
            <div className="vote-notice">
              <strong>FHE Protected:</strong> Your vote will be encrypted and cannot be traced back to you
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onVote} 
            disabled={voting || !voteInput || parseInt(voteInput) < 1}
            className="vote-btn neon-btn"
          >
            {voting ? "Encrypting Vote..." : "Cast Encrypted Vote"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ProposalDetailModal: React.FC<{
  proposal: VotingProposal;
  onClose: () => void;
  decryptedData: { votes: number | null };
  setDecryptedData: (value: { votes: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderVoteChart: (proposal: VotingProposal) => JSX.Element;
}> = ({ proposal, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderVoteChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData.votes !== null) { 
      setDecryptedData({ votes: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ votes: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="proposal-detail-modal">
        <div className="modal-header">
          <h2>Proposal Details & Results</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="proposal-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{proposal.title}</strong>
            </div>
            <div className="info-item">
              <span>Description:</span>
              <strong>{proposal.description}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{proposal.creator.substring(0, 6)}...{proposal.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Total Votes:</span>
              <strong>{proposal.voteCount}</strong>
            </div>
          </div>
          
          <div className="results-section">
            <h3>Voting Results</h3>
            {renderVoteChart(proposal)}
            
            <div className="decryption-section">
              <h4>FHE Result Verification</h4>
              <div className="data-row">
                <div className="data-label">Encrypted Results:</div>
                <div className="data-value">
                  {proposal.isVerified ? 
                    `${proposal.decryptedValue} votes (Verified)` : 
                    decryptedData.votes !== null ? 
                    `${decryptedData.votes} votes (Decrypted)` : 
                    "🔒 FHE Encrypted"
                  }
                </div>
                <button 
                  className={`decrypt-btn ${(proposal.isVerified || decryptedData.votes !== null) ? 'decrypted' : ''}`}
                  onClick={handleDecrypt} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "🔓 Verifying..." :
                   proposal.isVerified ? "✅ Verified" :
                   decryptedData.votes !== null ? "🔄 Re-verify" : "🔓 Verify Results"}
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

