import { useState, useEffect } from 'react';
import { Users, Ban, CheckCircle, DollarSign, Search, RefreshCw, Shield, AlertTriangle, TrendingUp, LogOut } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { useDialog } from '../hooks/useDialog';

interface User {
  id: string;
  username: string;
  balance: number;
  coins: number;
  userType: string;
  isBanned: boolean;
  bannedAt: string | null;
  banReason: string | null;
  reportCount: number;
  createdAt: string;
  pixKey: string | null;
}

interface Report {
  id: string;
  reportedUserId: string;
  reportedUsername: string;
  reporterUserId: string;
  reporterUsername: string;
  roomId: string | null;
  reason: string;
  createdAt: string;
}

interface Stats {
  users: {
    total: number;
    banned: number;
    active: number;
  };
  reports: {
    total: number;
  };
  rooms: {
    total: number;
    active: number;
  };
  matches: {
    total: number;
  };
  balance: {
    total: number;
  };
}

export default function AdminPanel() {
  const { showNotification } = useNotification();
  const { showConfirm, showPrompt, DialogComponent } = useDialog();
  const [users, setUsers] = useState<User[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'reports' | 'stats'>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [userId] = useState(() => {
    // Get userId from localStorage or session
    return localStorage.getItem('userId') || '';
  });

  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  useEffect(() => {
    if (userId) {
      fetchStats();
      if (activeTab === 'users') {
        fetchUsers();
      } else if (activeTab === 'reports') {
        fetchReports();
      }
    }
  }, [userId, activeTab, currentPage, searchQuery]);

  const fetchUsers = async () => {
    const { authenticatedFetch } = await import('../utils/api');
    if (!userId) return;
    setLoading(true);
    try {
      const response = await authenticatedFetch(`${API_BASE}/api/admin/users`, {
        method: 'POST',
        body: JSON.stringify({
          page: currentPage,
          limit: 20,
          search: searchQuery,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
        setTotalPages(data.pagination?.totalPages || 1);
      } else {
        const error = await response.json();
        if (error.error === 'Admin access required') {
          showNotification('Admin access required', 'error');
          window.location.href = '/';
        } else {
          showNotification(error.error || 'Failed to fetch users', 'error');
        }
      }
    } catch (error) {
      showNotification('Error fetching users', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchReports = async () => {
    const { authenticatedFetch } = await import('../utils/api');
    if (!userId) return;
    setLoading(true);
    try {
      const response = await authenticatedFetch(`${API_BASE}/api/admin/reports`, {
        method: 'POST',
        body: JSON.stringify({
          page: currentPage,
          limit: 20,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setReports(data.reports || []);
        setTotalPages(data.pagination?.totalPages || 1);
      } else {
        const error = await response.json();
        if (error.error === 'Admin access required') {
          showNotification('Admin access required', 'error');
          window.location.href = '/';
        } else {
          showNotification(error.error || 'Failed to fetch reports', 'error');
        }
      }
    } catch (error) {
      showNotification('Error fetching reports', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    const { authenticatedFetch } = await import('../utils/api');
    if (!userId) return;
    try {
      const response = await authenticatedFetch(`${API_BASE}/api/admin/stats`, {
        method: 'POST',
        body: JSON.stringify({}),
      });

      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const handleBanUser = async (targetUserId: string, username: string) => {
    const { authenticatedFetch } = await import('../utils/api');
    if (!userId) return;
    
    const reason = await showPrompt(`Enter ban reason for ${username}:`, {
      title: 'Ban User',
      type: 'warning',
      placeholder: 'Enter ban reason...',
      confirmText: 'Ban',
      cancelText: 'Cancel',
    });
    
    if (!reason) return;

    try {
      const response = await authenticatedFetch(`${API_BASE}/api/admin/users/ban`, {
        method: 'POST',
        body: JSON.stringify({
          targetUserId,
          banReason: reason,
        }),
      });

      if (response.ok) {
        showNotification(`User ${username} banned successfully`, 'success');
        fetchUsers();
        fetchStats();
      } else {
        const error = await response.json();
        showNotification(error.error || 'Failed to ban user', 'error');
      }
    } catch (error) {
      showNotification('Error banning user', 'error');
    }
  };

  const handleUnbanUser = async (targetUserId: string, username: string) => {
    const { authenticatedFetch } = await import('../utils/api');
    if (!userId) return;
    
    const confirmed = await showConfirm(`Unban user ${username}?`, {
      title: 'Unban User',
      type: 'info',
      confirmText: 'Unban',
      cancelText: 'Cancel',
    });
    
    if (!confirmed) return;

    try {
      const response = await authenticatedFetch(`${API_BASE}/api/admin/users/unban`, {
        method: 'POST',
        body: JSON.stringify({
          targetUserId,
        }),
      });

      if (response.ok) {
        showNotification(`User ${username} unbanned successfully`, 'success');
        fetchUsers();
        fetchStats();
      } else {
        const error = await response.json();
        showNotification(error.error || 'Failed to unban user', 'error');
      }
    } catch (error) {
      showNotification('Error unbanning user', 'error');
    }
  };

  const handleUpdateBalance = async (targetUserId: string, username: string, currentBalance: number) => {
    if (!userId) return;
    
    const newBalanceStr = await showPrompt(`Enter new balance for ${username} (current: R$ ${currentBalance.toFixed(2)}):`, {
      title: 'Update Balance',
      type: 'info',
      placeholder: `Current: R$ ${currentBalance.toFixed(2)}`,
      defaultValue: currentBalance.toFixed(2),
      confirmText: 'Update',
      cancelText: 'Cancel',
    });
    
    if (!newBalanceStr) return;

    const balance = parseFloat(newBalanceStr);
    if (isNaN(balance) || balance < 0) {
      showNotification('Invalid balance amount', 'error');
      return;
    }

    try {
      const { authenticatedFetch } = await import('../utils/api');
      const response = await authenticatedFetch(`${API_BASE}/api/admin/users/balance`, {
        method: 'POST',
        body: JSON.stringify({
          targetUserId,
          balance,
        }),
      });

      if (response.ok) {
        showNotification(`Balance updated for ${username}`, 'success');
        fetchUsers();
      } else {
        const error = await response.json();
        showNotification(error.error || 'Failed to update balance', 'error');
      }
    } catch (error) {
      showNotification('Error updating balance', 'error');
    }
  };

  return (
    <>
      {DialogComponent}
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-8 h-8 text-red-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
                <p className="text-sm text-gray-600">User Management & System Control</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">
                {localStorage.getItem('username') || 'Admin'}
              </span>
              <button
                onClick={async () => {
                  const confirmed = await showConfirm('Are you sure you want to logout?', {
                    title: 'Logout',
                    type: 'warning',
                    confirmText: 'Logout',
                    cancelText: 'Cancel',
                  });
                  
                  if (confirmed) {
                    const { clearAuth } = await import('../utils/api');
                    const { disconnectSocket } = await import('../utils/socket');
                    clearAuth();
                    disconnectSocket();
                    window.location.href = '/';
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-blue-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Users</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.users.total}</p>
                </div>
                <Users className="w-8 h-8 text-blue-500" />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {stats.users.active} active, {stats.users.banned} banned
              </p>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-red-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Reports</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.reports.total}</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-green-500">
              <div className="flex items-center justify-between">
                 <div>
                   <p className="text-sm text-gray-600">Total Balance</p>
                   <p className="text-2xl font-bold text-gray-900">
                     R$ {typeof stats.balance.total === 'number' 
                       ? stats.balance.total.toFixed(2) 
                       : (stats.balance.total ? Number(stats.balance.total).toFixed(2) : '0.00')}
                   </p>
                 </div>
                <DollarSign className="w-8 h-8 text-green-500" />
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-purple-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Active Rooms</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.rooms.active}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-purple-500" />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {stats.rooms.total} total rooms
              </p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-lg mb-6">
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => {
                setActiveTab('users');
                setCurrentPage(1);
                setSearchQuery('');
              }}
              className={`flex-1 px-6 py-4 font-semibold transition-colors ${
                activeTab === 'users'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Users className="w-5 h-5 inline mr-2" />
              Users
            </button>
            <button
              onClick={() => {
                setActiveTab('reports');
                setCurrentPage(1);
              }}
              className={`flex-1 px-6 py-4 font-semibold transition-colors ${
                activeTab === 'reports'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <AlertTriangle className="w-5 h-5 inline mr-2" />
              Reports
            </button>
            <button
              onClick={() => {
                setActiveTab('stats');
                fetchStats();
              }}
              className={`flex-1 px-6 py-4 font-semibold transition-colors ${
                activeTab === 'stats'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <TrendingUp className="w-5 h-5 inline mr-2" />
              Statistics
            </button>
          </div>

          {/* Users Tab */}
          {activeTab === 'users' && (
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="Search users by username or ID..."
                    className="w-full pl-10 pr-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <button
                  onClick={fetchUsers}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
              </div>

              {loading ? (
                <div className="text-center py-8">
                  <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : users.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p>No users found</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Username</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Balance</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Reports</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {users.map((user) => (
                        <tr key={user.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium text-gray-900">{user.username}</p>
                              <p className="text-xs text-gray-500">{user.id.substring(0, 8)}...</p>
                            </div>
                          </td>
                           <td className="px-4 py-3">
                             <span className="font-semibold text-green-600">
                               R$ {typeof user.balance === 'number' 
                                 ? user.balance.toFixed(2) 
                                 : Number(user.balance || 0).toFixed(2)}
                             </span>
                           </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                              user.userType === 'admin'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}>
                              {user.userType}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {user.isBanned ? (
                              <span className="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs font-semibold flex items-center gap-1 w-fit">
                                <Ban className="w-3 h-3" />
                                Banned
                              </span>
                            ) : (
                              <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold flex items-center gap-1 w-fit">
                                <CheckCircle className="w-3 h-3" />
                                Active
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-gray-900 font-medium">{user.reportCount}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {user.isBanned ? (
                                <button
                                  onClick={() => handleUnbanUser(user.id, user.username)}
                                  className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors"
                                >
                                  Unban
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleBanUser(user.id, user.username)}
                                  className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 transition-colors"
                                >
                                  Ban
                                </button>
                              )}
                              <button
                                onClick={() => handleUpdateBalance(user.id, user.username, user.balance)}
                                className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
                              >
                                Balance
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4">
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-gray-600">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Reports Tab */}
          {activeTab === 'reports' && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">User Reports</h3>
                <button
                  onClick={fetchReports}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
              </div>

              {loading ? (
                <div className="text-center py-8">
                  <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : reports.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p>No reports found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {reports.map((report) => (
                    <div
                      key={report.id}
                      className="border-2 border-gray-200 rounded-lg p-4 hover:border-red-300 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-semibold text-gray-900">
                            Reported: <span className="text-red-600">{report.reportedUsername}</span>
                          </p>
                          <p className="text-sm text-gray-600">
                            By: <span className="text-gray-900">{report.reporterUsername}</span>
                          </p>
                        </div>
                        <span className="text-xs text-gray-500">
                          {new Date(report.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-gray-700 mt-2">{report.reason}</p>
                      {report.roomId && (
                        <p className="text-xs text-gray-500 mt-2">Room ID: {report.roomId}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Stats Tab */}
          {activeTab === 'stats' && stats && (
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">System Statistics</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Users</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Users:</span>
                      <span className="font-semibold">{stats.users.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Active Users:</span>
                      <span className="font-semibold text-green-600">{stats.users.active}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Banned Users:</span>
                      <span className="font-semibold text-red-600">{stats.users.banned}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Content</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Reports:</span>
                      <span className="font-semibold">{stats.reports.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Rooms:</span>
                      <span className="font-semibold">{stats.rooms.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Active Rooms:</span>
                      <span className="font-semibold text-green-600">{stats.rooms.active}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Matches:</span>
                      <span className="font-semibold">{stats.matches.total}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Financial</h4>
                  <div className="space-y-2 text-sm">
                     <div className="flex justify-between">
                       <span className="text-gray-600">Total Platform Balance:</span>
                       <span className="font-semibold text-green-600">
                         R$ {typeof stats.balance.total === 'number' 
                           ? stats.balance.total.toFixed(2) 
                           : (stats.balance.total ? Number(stats.balance.total).toFixed(2) : '0.00')}
                       </span>
                     </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

