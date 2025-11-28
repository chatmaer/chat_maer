import { useState, useEffect, useRef } from 'react';
import { Video, VideoOff, Mic, MicOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RTCManager, getLocalStream, startVideo, toggleAudio, toggleVideoTrack } from '../utils/webrtc';
import { getSocket } from '../utils/socket';
import { useNotification } from '../contexts/NotificationContext';

interface VideoPanelProps {
  onStartVideo: () => void;
  players?: Array<{ id: string; username: string }>;
  currentUserId?: string;
  roomId?: string;
}

export default function VideoPanel({ 
  onStartVideo, 
  players, 
  currentUserId,
  roomId 
}: VideoPanelProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotification();
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isMuted, setIsMuted] = useState(true); // Start muted by default
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); // Prevent double-clicks
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const rtcManagerRef = useRef<RTCManager | null>(null);
  const socketRef = useRef(getSocket());
  // Track previous players to prevent unnecessary re-renders
  const playersRef = useRef(players);
  
  // Create stable key from players (only changes when player IDs change, not array reference)
  const playersKey = players?.map(p => p.id).sort().join(',') || '';

  // Helper function to set up track handlers (ensures they're always set up)
  const setupTrackHandlers = (rtcManager: RTCManager) => {
    // Remove any existing track listeners to avoid duplicates
    rtcManager.removeAllListeners('track');
    rtcManager.removeAllListeners('icecandidate');
    
    const socket = socketRef.current;
    
    // Handle remote track - ensure it only goes to remote video element
    rtcManager.on('track', (remoteStream: MediaStream) => {
      console.log('Remote track received:', remoteStream);
      if (remoteVideoRef.current && remoteStream) {
        // Ensure we're not accidentally assigning local stream
        const localStream = getLocalStream();
        const isLocalStream = localStream && (
          remoteStream === localStream || 
          remoteStream.id === localStream.id ||
          // Check track IDs to be extra sure
          (remoteStream.getVideoTracks().length > 0 && 
           localStream.getVideoTracks().length > 0 &&
           remoteStream.getVideoTracks()[0].id === localStream.getVideoTracks()[0].id)
        );
        
        if (!isLocalStream) {
          // Ensure local video element doesn't have this stream
          if (localVideoRef.current && localVideoRef.current.srcObject === remoteStream) {
            console.warn('Preventing local video from showing remote stream');
            localVideoRef.current.srcObject = null;
          }
          
          remoteVideoRef.current.srcObject = remoteStream;
          setHasRemoteVideo(true);
          remoteVideoRef.current.play().catch((err) => {
            console.error('Error playing remote video:', err);
          });
        } else {
          console.warn('Received local stream as remote stream, ignoring');
        }
      }
    });

    // Handle ICE candidates
    if (socket) {
      rtcManager.on('icecandidate', (candidate: RTCIceCandidate) => {
        socket.emit('webrtc_ice_candidate', {
          candidate: candidate.toJSON(),
        });
      });
    }
  };

  // Initialize WebRTC connection when both players are present
  useEffect(() => {
    // Update ref with current players
    playersRef.current = players;
    
    if (!roomId || !players || players.length < 2 || !currentUserId) {
      return;
    }

    const socket = socketRef.current;
    if (!socket) return;

    // Listen for WebRTC offer
    const handleWebRTCOffer = async (data: { 
      senderId: string; 
      offer: RTCSessionDescriptionInit 
    }) => {
      if (data.senderId === currentUserId) return;

      try {
        setIsConnecting(true);
        const localStream = getLocalStream();
        
        if (!rtcManagerRef.current) {
          // Create new peer connection
          rtcManagerRef.current = new RTCManager();
          
          // Set up track handlers immediately
          setupTrackHandlers(rtcManagerRef.current);
          
          if (localStream) {
            rtcManagerRef.current.addTracks(localStream);
          }
        } else {
          // Peer connection exists - ensure track handlers are set up
          setupTrackHandlers(rtcManagerRef.current);
          
          // Update tracks if needed (for renegotiation)
          if (localStream) {
            rtcManagerRef.current.replaceTracks(localStream);
          }
        }

        const answer = await rtcManagerRef.current.createAnswer(data.offer);
        socket.emit('webrtc_answer', { answer });
        setIsConnecting(false);
      } catch (error) {
        console.error('Error handling WebRTC offer:', error);
        setIsConnecting(false);
      }
    };

    // Listen for WebRTC answer
    const handleWebRTCAnswer = async (data: { 
      senderId: string; 
      answer: RTCSessionDescriptionInit 
    }) => {
      if (data.senderId === currentUserId || !rtcManagerRef.current) return;

      try {
        await rtcManagerRef.current.setAnswer(data.answer);
        setIsConnecting(false);
      } catch (error) {
        console.error('Error handling WebRTC answer:', error);
        setIsConnecting(false);
      }
    };

    // Listen for ICE candidates
    const handleICECandidate = async (data: { 
      senderId: string; 
      candidate: RTCIceCandidateInit 
    }) => {
      if (data.senderId === currentUserId || !rtcManagerRef.current) return;

      try {
        await rtcManagerRef.current.addIceCandidate(data.candidate);
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    };

    socket.on('webrtc_offer', handleWebRTCOffer);
    socket.on('webrtc_answer', handleWebRTCAnswer);
    socket.on('webrtc_ice_candidate', handleICECandidate);

    return () => {
      socket.off('webrtc_offer', handleWebRTCOffer);
      socket.off('webrtc_answer', handleWebRTCAnswer);
      socket.off('webrtc_ice_candidate', handleICECandidate);
    };
  }, [roomId, playersKey, currentUserId]); // Use stable key instead of players array reference

  // Update local video when stream is available - ensure it only shows local stream
  useEffect(() => {
    const updateLocalVideo = async () => {
      const localStream = getLocalStream();
      if (localVideoRef.current && localStream) {
        // Only update if srcObject is different and ensure it's the local stream
        const currentSrcObject = localVideoRef.current.srcObject as MediaStream | null;
        if (currentSrcObject !== localStream && currentSrcObject?.id !== localStream.id) {
          // Double-check: ensure we're not accidentally assigning remote stream
          const remoteStream = rtcManagerRef.current?.getRemoteStream();
          if (localStream !== remoteStream && localStream.id !== remoteStream?.id) {
            localVideoRef.current.srcObject = localStream;
            // Ensure video plays after setting stream
            try {
              await localVideoRef.current.play();
            } catch (error) {
              console.error('Error playing local video:', error);
            }
          }
        }
      } else if (localVideoRef.current && !localStream) {
        // Clear local video if stream is not available
        localVideoRef.current.srcObject = null;
      }
    };

    // Update immediately when isVideoOn changes
    updateLocalVideo();
    
    // Also set up interval to catch any delayed stream availability
    const interval = setInterval(updateLocalVideo, 500);

    return () => clearInterval(interval);
  }, [isVideoOn]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rtcManagerRef.current) {
        rtcManagerRef.current.destroy();
        rtcManagerRef.current = null;
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      setHasRemoteVideo(false);
    };
  }, []);

  const getErrorMessage = (error: any): string => {
    if (error instanceof Error) {
      const errorName = error.name;
      const errorMessage = error.message.toLowerCase();
      
      if (errorName === 'NotFoundError' || errorMessage.includes('not found')) {
        return 'No camera or microphone found. Please connect a camera/microphone and try again.';
      } else if (errorName === 'NotAllowedError' || errorMessage.includes('permission denied') || errorMessage.includes('not allowed')) {
        return 'Camera/microphone permission denied. Please allow access in your browser settings and try again.';
      } else if (errorName === 'NotReadableError' || errorMessage.includes('not readable') || errorMessage.includes('already in use')) {
        return 'Camera/microphone is already in use by another application. Please close other apps and try again.';
      } else if (errorName === 'OverconstrainedError' || errorMessage.includes('constraint')) {
        return 'Camera/microphone settings are not supported. Please try different settings.';
      } else if (errorName === 'SecurityError' || errorMessage.includes('security')) {
        return 'Camera/microphone access is blocked for security reasons. Please check your browser settings.';
      } else if (errorName === 'TypeError' || errorMessage.includes('getusermedia')) {
        return 'Video chat is not supported in this browser. Please use a modern browser like Chrome, Firefox, or Edge.';
      }
    }
    return 'Failed to access camera/microphone. Please check your device settings and try again.';
  };

  const toggleVideo = async () => {
    // Prevent double-clicks and rapid clicking
    if (isProcessing) {
      return;
    }

    if (!isVideoOn) {
      setIsProcessing(true);
      try {
        // Start local video
        const stream = await startVideo();
        await onStartVideo();
        
        // Set the stream to video element immediately
        if (localVideoRef.current && stream) {
          localVideoRef.current.srcObject = stream;
          // Ensure video plays
          await localVideoRef.current.play().catch(console.error);
          setIsVideoOn(true);
        }

        // Initialize or update WebRTC if both players are present
        if (roomId && players && players.length >= 2 && currentUserId) {
          const socket = socketRef.current;
          if (socket) {
            const localStream = getLocalStream();
            
            if (!rtcManagerRef.current) {
              // Create new peer connection
              setIsConnecting(true);
              rtcManagerRef.current = new RTCManager();
              
              // Set up track handlers immediately
              setupTrackHandlers(rtcManagerRef.current);
              
              if (localStream) {
                rtcManagerRef.current.addTracks(localStream);
              }

              // Create and send offer
              try {
                const offer = await rtcManagerRef.current.createOffer();
                socket.emit('webrtc_offer', { offer });
              } catch (error) {
                console.error('Error creating WebRTC offer:', error);
                setIsConnecting(false);
                showNotification('Failed to establish video connection', 'error');
              }
            } else {
              // Peer connection already exists - ensure track handlers are set up
              setupTrackHandlers(rtcManagerRef.current);
              
              // Update tracks and renegotiate
              if (localStream) {
                try {
                  setIsConnecting(true);
                  // Replace tracks with new stream
                  rtcManagerRef.current.replaceTracks(localStream);
                  
                  // Renegotiate connection
                  const offer = await rtcManagerRef.current.renegotiate();
                  socket.emit('webrtc_offer', { offer });
                } catch (error) {
                  console.error('Error renegotiating WebRTC connection:', error);
                  setIsConnecting(false);
                  showNotification('Failed to update video connection', 'error');
                }
              }
            }
          }
        }
        setIsProcessing(false);
      } catch (error) {
        setIsProcessing(false);
        const errorMessage = getErrorMessage(error);
        showNotification(errorMessage, 'error');
        console.error('Failed to start video:', error);
      }
    } else {
      // Turn off video - disable track but keep peer connection alive
      toggleVideoTrack(false);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      setIsVideoOn(false);
      
      // Note: We don't remove tracks from peer connection when toggling off
      // This allows us to easily re-enable them later without full renegotiation
      // The track is just disabled, not removed
    }
  };

  const toggleMute = () => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    toggleAudio(!newMutedState);
  };

  const getOpponentUsername = () => {
    if (!currentUserId || !players || players.length < 2) return t('common.opponent');
    const opponent = players.find((p) => p.id !== currentUserId);
    return opponent?.username || t('common.opponent');
  };

  const opponentUsername = getOpponentUsername();
  const opponentInitial = opponentUsername[0]?.toUpperCase() || 'O';

  return (
    <div className="bg-white rounded-lg sm:rounded-xl shadow-lg p-2 sm:p-3 flex flex-col">
      <div className="flex items-center justify-between mb-1.5 sm:mb-2 flex-shrink-0">
        <h3 className="font-semibold text-gray-800 text-xs sm:text-sm">{t('video.title')}</h3>
        {isConnecting && (
          <span className="text-xs text-blue-600">{t('video.connecting')}</span>
        )}
      </div>

      <div className="flex-1 grid grid-cols-2 gap-1.5 sm:gap-2 min-h-0 relative">
        {/* Local Video */}
        <div className="aspect-video bg-gradient-to-br from-gray-800 to-gray-900 rounded-md sm:rounded-lg flex items-center justify-center relative overflow-hidden">
          <video 
            ref={localVideoRef}
            className="w-full h-full object-cover absolute inset-0"
            autoPlay 
            muted 
            playsInline 
            style={{ display: isVideoOn ? 'block' : 'none' }}
          />
          {!isVideoOn && (
            <div className="absolute inset-0 flex items-center justify-center text-center">
              <div className="px-1">
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-1">
                  <span className="text-white text-sm sm:text-base font-bold">Y</span>
                </div>
                <p className="text-gray-400 text-[10px] sm:text-xs truncate max-w-full" title={t('common.you')}>{t('common.you')}</p>
              </div>
            </div>
          )}
          <div className="absolute bottom-1 left-1 bg-black/50 text-white text-[10px] sm:text-xs px-1 py-0.5 rounded max-w-[calc(50%-0.25rem)] truncate" title={t('common.you')}>
            {t('common.you')}
          </div>
        </div>

        {/* Remote Video */}
        <div className="aspect-video bg-gradient-to-br from-gray-800 to-gray-900 rounded-md sm:rounded-lg flex items-center justify-center relative overflow-hidden">
          <video 
            ref={remoteVideoRef}
            className="w-full h-full object-cover absolute inset-0" 
            autoPlay 
            playsInline 
            style={{ display: hasRemoteVideo ? 'block' : 'none' }}
          />
          {!hasRemoteVideo && (
            <div className="absolute inset-0 flex items-center justify-center text-center">
              <div className="px-1">
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-1">
                  <span className="text-white text-sm sm:text-base font-bold">
                    {opponentInitial}
                  </span>
                </div>
                <p className="text-gray-400 text-[10px] sm:text-xs truncate max-w-full" title={opponentUsername}>
                  {opponentUsername}
                </p>
              </div>
            </div>
          )}
          <div className="absolute bottom-1 left-1 bg-black/50 text-white text-[10px] sm:text-xs px-1 py-0.5 rounded max-w-[calc(50%-0.25rem)] truncate" title={opponentUsername}>
            {opponentUsername}
          </div>
        </div>

        {/* Control buttons positioned over the video area */}
        <div className="absolute bottom-1 sm:bottom-2 left-1/2 transform -translate-x-1/2 flex gap-1 sm:gap-1.5 justify-center z-10">
          <button
            onClick={toggleVideo}
            disabled={isProcessing}
            className={`p-1.5 sm:p-2 rounded-full transition-colors shadow-lg touch-manipulation min-h-[36px] min-w-[36px] sm:min-h-[40px] sm:min-w-[40px] flex items-center justify-center ${
              isVideoOn
                ? 'bg-blue-600 text-white active:bg-blue-700 sm:hover:bg-blue-700'
                : 'bg-gray-200 text-gray-700 active:bg-gray-300 sm:hover:bg-gray-300'
            } ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={isVideoOn ? 'Turn off video' : 'Turn on video'}
          >
            {isVideoOn ? <Video className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <VideoOff className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
          </button>

          <button
            onClick={toggleMute}
            className={`p-1.5 sm:p-2 rounded-full transition-colors shadow-lg touch-manipulation min-h-[36px] min-w-[36px] sm:min-h-[40px] sm:min-w-[40px] flex items-center justify-center ${
              isMuted
                ? 'bg-gray-200 text-gray-700 active:bg-gray-300 sm:hover:bg-gray-300'
                : 'bg-blue-600 text-white active:bg-blue-700 sm:hover:bg-blue-700'
            }`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Mic className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
