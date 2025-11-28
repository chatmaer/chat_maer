import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Send } from 'lucide-react';

interface Message {
  id: string;
  sender: string;
  text: string;
  timestamp: Date;
  isOwn: boolean;
}

interface ChatPanelProps {
  onSendMessage: (message: string) => void;
  messages: Message[];
}

export default function ChatPanel({ onSendMessage, messages }: ChatPanelProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (inputValue.trim()) {
      onSendMessage(inputValue);
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      handleSend();
      return false;
    }
  };

  return (
    <div className="bg-white rounded-lg sm:rounded-xl shadow-lg flex flex-col h-full">
      <div className="p-2 sm:p-3 border-b border-gray-200">
        <h3 className="font-semibold text-gray-800 text-xs sm:text-sm">{t('chat.title')}</h3>
      </div>

      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-1.5 sm:space-y-2">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 text-xs mt-4 sm:mt-6">
            {t('chat.noMessages')}
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.isOwn ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-lg sm:rounded-xl px-2 sm:px-3 py-1 sm:py-1.5 ${
                  msg.isOwn
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                }`}
              >
                {!msg.isOwn && (
                  <p className="text-[10px] sm:text-xs font-semibold mb-0.5 opacity-75">{msg.sender}</p>
                )}
                <p className="text-[11px] sm:text-xs break-words">{msg.text}</p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-2 sm:p-3 border-t border-gray-200">
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleSend();
            return false;
          }}
          className="flex gap-1.5 sm:gap-2 items-center"
        >
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.typeMessage')}
            className="flex-1 px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="submit"
            className="w-8 h-8 sm:w-9 sm:h-9 min-w-[2rem] min-h-[2rem] sm:min-w-[2.25rem] sm:min-h-[2.25rem] bg-blue-600 text-white rounded-full active:bg-blue-700 sm:hover:bg-blue-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shrink-0 active:scale-95 shadow-md active:shadow-lg sm:hover:shadow-lg touch-manipulation"
            disabled={!inputValue.trim()}
            aria-label={t('chat.send')}
          >
            <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
