import { useState, useEffect, useRef } from 'react';
import { Video, VideoOff, Mic, MicOff, PhoneOff } from 'lucide-react';
import { RTCManager, getLocalStream, startVideo, stopVideo, toggleAudio, toggleVideoTrack } from '../utils/webrtc';
import { getSocket } from '../utils/socket';
import { useNotification } from '../contexts/NotificationContext';

interface VideoPanelProps {
  onStartVideo: () => void;
  onEndCall: () => void;
  players?: Array<{ id: string; username: string }>;
  currentUserId?: string;
  roomId?: string;
}

export default function VideoPanel({ 
  onStartVideo, 
  onEndCall, 
  players, 
  currentUserId,
  roomId 
}: VideoPanelProps) {
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
          
          if (localStream) {
            rtcManagerRef.current.addTracks(localStream);
          }

          // Handle remote track
          rtcManagerRef.current.on('track', (stream: MediaStream) => {
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = stream;
              setHasRemoteVideo(true);
              remoteVideoRef.current.play().catch(console.error);
            }
          });

          // Handle ICE candidates
          rtcManagerRef.current.on('icecandidate', (candidate: RTCIceCandidate) => {
            socket.emit('webrtc_ice_candidate', {
              candidate: candidate.toJSON(),
            });
          });
        } else {
          // Peer connection exists - update tracks if needed (for renegotiation)
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

  // Update local video when stream is available
  useEffect(() => {
    const updateLocalVideo = async () => {
      const localStream = getLocalStream();
      if (localVideoRef.current && localStream) {
        // Only update if srcObject is different
        if (localVideoRef.current.srcObject !== localStream) {
          localVideoRef.current.srcObject = localStream;
          // Ensure video plays after setting stream
          try {
            await localVideoRef.current.play();
          } catch (error) {
            console.error('Error playing local video:', error);
          }
        }
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
              if (localStream) {
                rtcManagerRef.current.addTracks(localStream);
              }

              // Handle remote track
              rtcManagerRef.current.on('track', (remoteStream: MediaStream) => {
                if (remoteVideoRef.current) {
                  remoteVideoRef.current.srcObject = remoteStream;
                  setHasRemoteVideo(true);
                  remoteVideoRef.current.play().catch(console.error);
                }
              });

              // Handle ICE candidates
              rtcManagerRef.current.on('icecandidate', (candidate: RTCIceCandidate) => {
                socket.emit('webrtc_ice_candidate', {
                  candidate: candidate.toJSON(),
                });
              });

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
              // Peer connection already exists - update tracks and renegotiate
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

  const handleEndCall = () => {
    if (rtcManagerRef.current) {
      rtcManagerRef.current.destroy();
      rtcManagerRef.current = null;
    }
    stopVideo();
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setIsVideoOn(false);
    setHasRemoteVideo(false);
    setIsMuted(false);
    setIsConnecting(false);
    onEndCall();
  };

  const getOpponentUsername = () => {
    if (!currentUserId || !players || players.length < 2) return 'Opponent';
    const opponent = players.find((p) => p.id !== currentUserId);
    return opponent?.username || 'Opponent';
  };

  const opponentUsername = getOpponentUsername();
  const opponentInitial = opponentUsername[0]?.toUpperCase() || 'O';

  return (
    <div className="bg-white rounded-2xl shadow-lg p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">Video Chat</h3>
        {isConnecting && (
          <span className="text-xs text-blue-600">Connecting...</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Local Video */}
        <div className="aspect-video bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl flex items-center justify-center relative overflow-hidden">
          <video 
            ref={localVideoRef}
            className={`w-full h-full object-cover ${isVideoOn ? 'block' : 'hidden'}`}
            autoPlay 
            muted 
            playsInline 
          />
          {!isVideoOn && (
            <div className="absolute inset-0 flex items-center justify-center text-center">
              <div>
                <div className="w-12 h-12 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-white text-xl font-bold">Y</span>
                </div>
                <p className="text-gray-400 text-xs">You</p>
              </div>
            </div>
          )}
          <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
            You
          </div>
        </div>

        {/* Remote Video */}
        <div className="aspect-video bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl flex items-center justify-center relative overflow-hidden">
          <video 
            ref={remoteVideoRef}
            className="w-full h-full object-cover" 
            autoPlay 
            playsInline 
            style={{ display: hasRemoteVideo ? 'block' : 'none' }}
          />
          {!hasRemoteVideo && (
            <div className="absolute inset-0 flex items-center justify-center text-center">
              <div>
                <div className="w-12 h-12 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-white text-xl font-bold">
                    {opponentInitial}
                  </span>
                </div>
                <p className="text-gray-400 text-xs">
                  {opponentUsername}
                </p>
              </div>
            </div>
          )}
          <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
            {opponentUsername}
          </div>
        </div>
      </div>

      <div className="flex gap-2 justify-center">
        <button
          onClick={toggleVideo}
          disabled={isProcessing}
          className={`p-3 rounded-full transition-colors ${
            isVideoOn
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          } ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={isVideoOn ? 'Turn off video' : 'Turn on video'}
        >
          {isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </button>

        <button
          onClick={toggleMute}
          className={`p-3 rounded-full transition-colors ${
            isMuted
              ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>

        <button
          onClick={handleEndCall}
          className="p-3 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors"
          title="End call"
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
