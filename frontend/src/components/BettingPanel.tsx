import { useState, useEffect } from 'react';
import { Coins, Lock, Unlock, Check, X } from 'lucide-react';
import { getSocket } from '../utils/socket';
import { useNotification } from '../contexts/NotificationContext';
import { useTranslation } from 'react-i18next';

interface BettingPanelProps {
  roomId?: string;
  userId?: string;
  players: Array<{ id: string; username: string }>;
}

export default function BettingPanel({
  roomId,
  userId,
  players,
}: BettingPanelProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotification();
  const [bettingAmount, setBettingAmount] = useState<number | string>(0.25);
  const [bettingStatus, setBettingStatus] = useState<'unlocked' | 'locked'>('unlocked');
  const [userBalance, setUserBalance] = useState<number | string>(0);
  const [proposedAmount, setProposedAmount] = useState<number | null>(null);
  const [isProposer, setIsProposer] = useState<boolean>(false);
  const [proposalAmount, setProposalAmount] = useState<number>(0.25);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !roomId) return;

    // Request betting info when component mounts
    socket.emit('get_betting_info');

    // Listen for betting info
    const handleBettingInfo = (data: {
      bettingAmount: number;
      bettingStatus: string;
      userBalance: number | string;
      roomId: string;
    }) => {
      if (data.roomId === roomId) {
        setBettingAmount(typeof data.bettingAmount === 'number' ? data.bettingAmount : Number(data.bettingAmount || 0));
        setBettingStatus(data.bettingStatus as 'unlocked' | 'locked');
        setUserBalance(typeof data.userBalance === 'number' 
          ? data.userBalance 
          : Number(data.userBalance || 0));
      }
    };

    // Listen for betting proposals
    const handleBettingProposal = (data: {
      proposerId: string;
      proposedAmount: number;
      roomId: string;
    }) => {
      if (data.roomId === roomId && data.proposerId !== userId) {
        setProposedAmount(data.proposedAmount);
        setIsProposer(false);
        showNotification(
          t('betting.newBettingProposal', { amount: data.proposedAmount.toFixed(2) }),
          'info',
        );
      }
    };

    // Listen for betting locked
    const handleBettingLocked = (data: { amount: number | string; roomId: string }) => {
      if (data.roomId === roomId) {
        const amountNum = typeof data.amount === 'number' ? data.amount : Number(data.amount || 0);
        setBettingAmount(amountNum);
        setBettingStatus('locked');
        setProposedAmount(null);
        showNotification(
          t('betting.bettingLockedAt', { amount: amountNum.toFixed(2) }),
          'success',
        );
        // Refresh balance
        socket.emit('get_betting_info');
      }
    };

    // Listen for proposal rejection
    const handleProposalRejected = (data: { roomId: string }) => {
      if (data.roomId === roomId) {
        setProposedAmount(null);
        showNotification(t('betting.bettingProposalRejected'), 'info');
      }
    };

    // Listen for balance updates (when game ends and betting payouts are processed)
    const handleBalanceUpdated = (data: {
      roomId: string;
      balances: Array<{ userId: string; balance: number }>;
      winnerId?: string | null;
      winnerPayout?: number;
      refundAmount?: number;
      isDraw: boolean;
    }) => {
      console.log('Balance updated event received:', data);
      if (data.roomId === roomId && userId) {
        // Find the current user's balance in the updated balances
        const userBalanceUpdate = data.balances.find((b) => b.userId === userId);
        if (userBalanceUpdate) {
          const newBalance = typeof userBalanceUpdate.balance === 'number' 
            ? userBalanceUpdate.balance 
            : Number(userBalanceUpdate.balance || 0);
          console.log('Updating balance from', userBalance, 'to', newBalance);
          setUserBalance(newBalance);
          
          // Show notification based on result
          if (data.isDraw) {
            showNotification(
              t('betting.gameEndedDraw', { amount: (data.refundAmount || 0).toFixed(2) }),
              'info',
            );
          } else if (data.winnerId === userId && data.winnerPayout) {
            showNotification(
              t('betting.youWon', { amount: data.winnerPayout.toFixed(2) }),
              'success',
            );
          } else if (data.winnerId && data.winnerId !== userId) {
            // Find winner username
            const winner = players.find((p) => p.id === data.winnerId);
            const winnerUsername = winner?.username || t('common.opponent');
            showNotification(
              t('betting.opponentWon', { username: winnerUsername }),
              'info',
            );
          }
        }
        
        // Force refresh betting info to ensure everything is in sync
        setTimeout(() => {
          socket.emit('get_betting_info');
        }, 500);
      }
    };

    // Listen for new match start (rematch) - reset betting state
    const handleNewMatchStart = (data: {
      roomId: string;
      bettingAmount?: number;
      bettingStatus?: string;
      balances?: Array<{ userId: string; balance: number }>;
    }) => {
      console.log('New match start event received:', data);
      if (data.roomId === roomId) {
        // Reset betting state for new match
        const newAmount = data.bettingAmount !== undefined 
          ? (typeof data.bettingAmount === 'number' ? data.bettingAmount : Number(data.bettingAmount || 0.25))
          : 0.25;
        const newStatus = (data.bettingStatus || 'unlocked') as 'unlocked' | 'locked';
        
        setBettingAmount(newAmount);
        setBettingStatus(newStatus);
        setProposedAmount(null);
        setIsProposer(false);
        setProposalAmount(newAmount);
        
        // Update balance if provided in the event
        if (data.balances && userId) {
          const userBalanceUpdate = data.balances.find((b) => b.userId === userId);
          if (userBalanceUpdate) {
            const newBalance = typeof userBalanceUpdate.balance === 'number' 
              ? userBalanceUpdate.balance 
              : Number(userBalanceUpdate.balance || 0);
            setUserBalance(newBalance);
          }
        }
        
        // Request fresh betting info including updated balance
        socket.emit('get_betting_info');
      }
    };

    socket.on('betting_info', handleBettingInfo);
    socket.on('betting_proposal', handleBettingProposal);
    socket.on('betting_locked', handleBettingLocked);
    socket.on('betting_proposal_rejected', handleProposalRejected);
    socket.on('balance_updated', handleBalanceUpdated);
    socket.on('new_match_start', handleNewMatchStart);

    return () => {
      socket.off('betting_info', handleBettingInfo);
      socket.off('betting_proposal', handleBettingProposal);
      socket.off('betting_locked', handleBettingLocked);
      socket.off('betting_proposal_rejected', handleProposalRejected);
      socket.off('balance_updated', handleBalanceUpdated);
      socket.off('new_match_start', handleNewMatchStart);
    };
  }, [roomId, userId, showNotification]);

  const handleProposeAmount = () => {
    if (!roomId || players.length < 2) {
      showNotification(t('betting.needTwoPlayers'), 'error');
      return;
    }

    if (proposalAmount <= 0) {
      showNotification(t('betting.amountMustBeGreater'), 'error');
      return;
    }

    const balanceNum = typeof userBalance === 'number' ? userBalance : Number(userBalance || 0);
    if (proposalAmount > balanceNum) {
      showNotification(t('betting.insufficientBalance'), 'error');
      return;
    }

    setIsLoading(true);
    const socket = getSocket();
    if (socket) {
      socket.emit('propose_betting_amount', { amount: proposalAmount });
      setProposedAmount(proposalAmount);
      setIsProposer(true);
      setIsLoading(false);
      showNotification(
        t('betting.newBettingProposal', { amount: proposalAmount.toFixed(2) }),
        'info',
      );
    }
  };

  const handleAcceptProposal = () => {
    if (!proposedAmount) return;

    setIsLoading(true);
    const socket = getSocket();
    if (socket) {
      socket.emit('accept_betting_amount', { amount: proposedAmount });
      setIsLoading(false);
    }
  };

  const handleRejectProposal = () => {
    setIsLoading(true);
    const socket = getSocket();
    if (socket) {
      socket.emit('reject_betting_amount');
      setProposedAmount(null);
      setIsProposer(false);
      setIsLoading(false);
    }
  };

  const canChangeBetting = players.length >= 2 && bettingStatus === 'unlocked';

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <Coins className="w-6 h-6 text-yellow-600" />
        <h3 className="text-xl font-bold text-gray-900">{t('betting.title')}</h3>
      </div>

      {/* User Balance */}
      <div className="mb-4 p-3 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border-2 border-green-200">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">{t('betting.yourBalance')}</span>
          <span className="text-lg font-bold text-green-700">
            R$ {typeof userBalance === 'number' 
              ? userBalance.toFixed(2) 
              : Number(userBalance || 0).toFixed(2)}
          </span>
        </div>
      </div>

      {/* Current Betting Amount */}
      <div className="mb-4 p-3 bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl border-2 border-blue-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            {t('betting.currentBettingAmount')}
          </span>
          <div className="flex items-center gap-2">
            {bettingStatus === 'locked' ? (
              <Lock className="w-4 h-4 text-red-600" />
            ) : (
              <Unlock className="w-4 h-4 text-green-600" />
            )}
            <span className="text-lg font-bold text-blue-700">
              R$ {typeof bettingAmount === 'number' 
                ? bettingAmount.toFixed(2) 
                : Number(bettingAmount || 0).toFixed(2)}
            </span>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          {bettingStatus === 'locked'
            ? t('betting.bettingLocked')
            : t('betting.bettingCanChange')}
        </p>
      </div>

      {/* Pending Proposal */}
      {proposedAmount !== null && !isProposer && (
        <div className="mb-4 p-4 bg-yellow-50 border-2 border-yellow-300 rounded-xl">
          <p className="text-sm font-medium text-yellow-800 mb-3">
            {(() => {
              const proposer = players.find((p) => p.id !== userId);
              const proposerName = proposer?.username || t('common.opponent');
              return `${proposerName} ${t('betting.proposed')}`;
            })()} <strong>R$ {proposedAmount.toFixed(2)}</strong>
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleAcceptProposal}
              disabled={isLoading}
              className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg font-semibold hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              {t('betting.accept')}
            </button>
            <button
              onClick={handleRejectProposal}
              disabled={isLoading}
              className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg font-semibold hover:bg-red-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <X className="w-4 h-4" />
              {t('betting.reject')}
            </button>
          </div>
        </div>
      )}

      {/* Proposal Sent */}
      {proposedAmount !== null && isProposer && (
        <div className="mb-4 p-4 bg-blue-50 border-2 border-blue-300 rounded-xl">
          <p className="text-sm font-medium text-blue-800">
            {t('betting.youProposed')} <strong>R$ {proposedAmount.toFixed(2)}</strong>
          </p>
          <p className="text-xs text-blue-600 mt-1">
            {(() => {
              const opponent = players.find((p) => p.id !== userId);
              const opponentName = opponent?.username || t('common.opponent');
              return t('betting.waitingForAccept', { username: opponentName });
            })()}
          </p>
        </div>
      )}

      {/* Change Betting Amount (only when unlocked and 2 players) */}
      {canChangeBetting && proposedAmount === null && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('betting.proposeNewAmount')}
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={proposalAmount}
              onChange={(e) => setProposalAmount(parseFloat(e.target.value) || 0)}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
              placeholder="0.25"
            />
            <p className="text-xs text-gray-500 mt-1">
              {t('betting.minimum')} R$ 0.01 | {t('betting.yourBalanceLabel')} R$ {typeof userBalance === 'number' 
                ? userBalance.toFixed(2) 
                : Number(userBalance || 0).toFixed(2)}
            </p>
          </div>
          <button
            onClick={handleProposeAmount}
            disabled={isLoading || proposalAmount <= 0 || proposalAmount > (typeof userBalance === 'number' ? userBalance : Number(userBalance || 0))}
            className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 text-white py-3 rounded-xl font-semibold hover:from-blue-700 hover:to-cyan-600 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('betting.proposeAmount')}
          </button>
        </div>
      )}

      {/* Info when waiting for second player */}
      {players.length < 2 && (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
          <p className="text-sm text-gray-600 text-center">
            {t('betting.waitingForPlayer')}
          </p>
        </div>
      )}

      {/* Winner payout info */}
      {bettingStatus === 'locked' && (
        <div className="mt-4 p-3 bg-purple-50 border-2 border-purple-200 rounded-xl">
          <p className="text-xs text-purple-700">
            <strong>{t('betting.winnerGets')}</strong> R${' '}
            {((typeof bettingAmount === 'number' ? bettingAmount : Number(bettingAmount || 0)) * 2 * 0.9).toFixed(2)} (90% {t('betting.ofPot')})
          </p>
          <p className="text-xs text-purple-600 mt-1">
            <strong>{t('betting.platformFee')}</strong> R${' '}
            {((typeof bettingAmount === 'number' ? bettingAmount : Number(bettingAmount || 0)) * 2 * 0.1).toFixed(2)} (10%)
          </p>
        </div>
      )}
    </div>
  );
}

