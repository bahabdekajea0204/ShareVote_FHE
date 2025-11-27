import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface VotingProposal {
  id: string;
  title: string;
  description: string;
  encryptedVotes: string;
  publicShares: number;
  endTime: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
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
    status: "pending", 
    message: "" 
  });
  const [newProposalData, setNewProposalData] = useState({ title: "", description: "", shares: "" });
  const [selectedProposal, setSelectedProposal] = useState<VotingProposal | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [faqOpen, setFaqOpen] = useState(false);
  const [stats, setStats] = useState({ total: 0, verified: 0, active: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized) return;
      try {
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      try {
        await loadData();
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
            encryptedVotes: businessId,
            publicShares: Number(businessData.publicValue1) || 0,
            endTime: Number(businessData.timestamp) + 604800,
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setProposals(proposalsList);
      updateStats(proposalsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (proposalsList: VotingProposal[]) => {
    const total = proposalsList.length;
    const verified = proposalsList.filter(p => p.isVerified).length;
    const active = proposalsList.filter(p => p.endTime > Date.now()/1000).length;
    setStats({ total, verified, active });
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
      
      const sharesValue = parseInt(newProposalData.shares) || 0;
      const businessId = `proposal-${Date.now()}`;
      const contractAddress = await contract.getAddress();
      
      const encryptedResult = await encrypt(contractAddress, address, sharesValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newProposalData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        sharesValue,
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
      setNewProposalData({ title: "", description: "", shares: "" });
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

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      const contractAddress = await contractRead.getAddress();
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and responding" 
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Contract call failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredProposals = proposals.filter(proposal =>
    proposal.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    proposal.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const itemsPerPage = 5;
  const totalPages = Math.ceil(filteredProposals.length / itemsPerPage);
  const paginatedProposals = filteredProposals.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>ShareVote FHE 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access encrypted shareholder voting system.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted voting system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>ShareVote FHE 🔐</h1>
          <span>Encrypted Shareholder Voting</span>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">
            Test Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Proposal
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-item">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Proposals</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.active}</div>
            <div className="stat-label">Active Votes</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified Results</div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search proposals..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="faq-toggle" onClick={() => setFaqOpen(!faqOpen)}>
            {faqOpen ? "Hide FAQ" : "Show FAQ"}
          </button>
        </div>

        {faqOpen && (
          <div className="faq-section">
            <h3>FHE Voting FAQ</h3>
            <div className="faq-item">
              <strong>How does FHE protect my vote?</strong>
              <p>Your vote is encrypted using Zama FHE technology, ensuring complete privacy while allowing secure tallying.</p>
            </div>
            <div className="faq-item">
              <strong>What data is encrypted?</strong>
              <p>Only the vote count is encrypted. Proposal details remain public for transparency.</p>
            </div>
            <div className="faq-item">
              <strong>How are results verified?</strong>
              <p>Results are decrypted and verified on-chain using zero-knowledge proofs.</p>
            </div>
          </div>
        )}

        <div className="proposals-section">
          <div className="section-header">
            <h2>Voting Proposals</h2>
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          
          <div className="proposals-list">
            {paginatedProposals.length === 0 ? (
              <div className="no-proposals">
                <p>No voting proposals found</p>
                <button className="create-btn" onClick={() => setShowCreateModal(true)}>
                  Create First Proposal
                </button>
              </div>
            ) : paginatedProposals.map((proposal, index) => (
              <div className="proposal-item" key={index} onClick={() => setSelectedProposal(proposal)}>
                <div className="proposal-title">{proposal.title}</div>
                <div className="proposal-description">{proposal.description}</div>
                <div className="proposal-meta">
                  <span>Shares: {proposal.publicShares}</span>
                  <span>Ends: {new Date(proposal.endTime * 1000).toLocaleDateString()}</span>
                </div>
                <div className="proposal-status">
                  {proposal.isVerified ? "✅ Results Verified" : "🔓 Awaiting Verification"}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button disabled={currentPage === 1} onClick={() => setCurrentPage(currentPage - 1)}>
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(currentPage + 1)}>
                Next
              </button>
            </div>
          )}
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
      
      {selectedProposal && (
        <ProposalDetailModal 
          proposal={selectedProposal} 
          onClose={() => setSelectedProposal(null)} 
          decryptData={() => decryptData(selectedProposal.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
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
    if (name === 'shares') {
      const intValue = value.replace(/[^\d]/g, '');
      setProposalData({ ...proposalData, [name]: intValue });
    } else {
      setProposalData({ ...proposalData, [name]: value });
    }
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
            <p>Vote counts will be encrypted with Zama FHE technology</p>
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
              placeholder="Enter proposal description..." 
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Initial Shares (Integer only) *</label>
            <input 
              type="number" 
              name="shares" 
              value={proposalData.shares} 
              onChange={handleChange} 
              placeholder="Enter share count..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !proposalData.title || !proposalData.description || !proposalData.shares} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ProposalDetailModal: React.FC<{
  proposal: VotingProposal;
  onClose: () => void;
  decryptData: () => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ proposal, onClose, decryptData, isDecrypting }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const result = await decryptData();
    setLocalDecrypted(result);
  };

  return (
    <div className="modal-overlay">
      <div className="proposal-detail-modal">
        <div className="modal-header">
          <h2>Proposal Details</h2>
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
              <span>Voting End:</span>
              <strong>{new Date(proposal.endTime * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Voting Data</h3>
            
            <div className="data-row">
              <div className="data-label">Vote Count:</div>
              <div className="data-value">
                {proposal.isVerified ? 
                  `${proposal.decryptedValue} (On-chain Verified)` : 
                  localDecrypted !== null ? 
                  `${localDecrypted} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(proposal.isVerified || localDecrypted !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 Verifying..." :
                 proposal.isVerified ? "✅ Verified" :
                 localDecrypted !== null ? "🔄 Re-verify" : "🔓 Verify Results"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Encrypted Tally</strong>
                <p>Vote counts are encrypted using Zama FHE technology for complete privacy.</p>
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