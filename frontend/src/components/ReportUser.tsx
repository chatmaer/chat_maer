import { useState } from 'react';
import { Flag, X } from 'lucide-react';
import { getSocket } from '../utils/socket';
import { useNotification } from '../contexts/NotificationContext';
import { useTranslation } from 'react-i18next';

interface ReportUserProps {
  reportedUserId: string;
  reportedUsername: string;
}

export default function ReportUser({ reportedUserId, reportedUsername }: ReportUserProps) {
  const { t } = useTranslation();
  const [showModal, setShowModal] = useState(false);
  const [reason, setReason] = useState('');
  const [selectedReason, setSelectedReason] = useState('');
  const { showNotification } = useNotification();

  const reportReasons = [
    t('report.reasons.inappropriateBehavior'),
    t('report.reasons.cheating'),
    t('report.reasons.harassment'),
    t('report.reasons.spam'),
    t('report.reasons.other'),
  ];

  const handleReport = () => {
    if (!selectedReason && !reason.trim()) {
      showNotification(t('report.selectOrEnterReason'), 'warning');
      return;
    }

    const finalReason = selectedReason === t('report.reasons.other') ? reason : selectedReason;

    if (!finalReason.trim()) {
      showNotification(t('report.enterReason'), 'warning');
      return;
    }

    const socket = getSocket();
    if (socket) {
      socket.emit('report_user', {
        reportedUserId,
        reason: finalReason,
      });

      socket.once('report_success', () => {
        showNotification(t('report.userReported'), 'success');
        setShowModal(false);
        setReason('');
        setSelectedReason('');
      });

      socket.once('error', (error: any) => {
        showNotification(error.message || t('report.failedToReport'), 'error');
      });
    }
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        title={t('report.title')}
      >
        <Flag className="w-4 h-4" />
        {t('report.title')}
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 shadow-xl max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">{t('report.title')}</h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  setReason('');
                  setSelectedReason('');
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              {t('report.reporting')} <span className="font-semibold">{reportedUsername}</span>
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('report.reasonForReporting')}
                </label>
                <div className="space-y-2">
                  {reportReasons.map((r) => (
                    <label
                      key={r}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="reason"
                        value={r}
                        checked={selectedReason === r}
                        onChange={(e) => setSelectedReason(e.target.value)}
                        className="w-4 h-4 text-red-600"
                      />
                      <span className="text-sm text-gray-700">{r}</span>
                    </label>
                  ))}
                </div>
              </div>

              {selectedReason === t('report.reasons.other') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('report.pleaseSpecify')}
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('report.describeIssue')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    rows={3}
                  />
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowModal(false);
                    setReason('');
                    setSelectedReason('');
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleReport}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  {t('report.submitReport')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

