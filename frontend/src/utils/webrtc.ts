import EventEmitter from 'eventemitter3';

// ICE server configuration
const iceConfig: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302'] },
    { urls: ['stun:stun1.l.google.com:19302'] },
  ],
};

// Local stream management
let localStream: MediaStream | null = null;

export const getLocalStream = (): MediaStream | null => {
  return localStream;
};

export const setLocalStream = (stream: MediaStream | null) => {
  localStream = stream;
};

export const destroyLocalStream = () => {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
};

export const startVideo = async (): Promise<MediaStream> => {
  // Check if getUserMedia is available
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const error = new Error('getUserMedia is not supported in this browser');
    (error as any).name = 'TypeError';
    throw error;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    // Disable audio track by default - user must click mic button to enable
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
    }
    return localStream;
  } catch (error) {
    // Don't log here - let the caller handle the error and show user-friendly message
    // Just re-throw so VideoPanel can handle it appropriately
    throw error;
  }
};

export const stopVideo = () => {
  destroyLocalStream();
};

export const toggleAudio = (enabled: boolean) => {
  if (localStream) {
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }
};

export const toggleVideoTrack = (enabled: boolean) => {
  if (localStream) {
    localStream.getVideoTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }
};

/**
 * RTCManager class to handle WebRTC peer connections
 * Based on chatrealm.live implementation
 */
export class RTCManager extends EventEmitter {
  private pc: RTCPeerConnection;
  private remoteStream: MediaStream | undefined;
  private localOffer: RTCSessionDescriptionInit | undefined;

  constructor() {
    super();
    this.pc = new RTCPeerConnection(iceConfig);
    this.setupEventListeners();
  }

  /**
   * Adds tracks from local stream to peer connection
   */
  addTracks(stream: MediaStream) {
    stream.getTracks().forEach((track) => {
      this.pc.addTrack(track, stream);
    });
  }

  /**
   * Removes all tracks from peer connection
   */
  removeTracks() {
    const senders = this.pc.getSenders();
    senders.forEach((sender) => {
      if (sender.track) {
        this.pc.removeTrack(sender);
      }
    });
  }

  /**
   * Replaces tracks in peer connection with new stream tracks
   */
  replaceTracks(stream: MediaStream) {
    const senders = this.pc.getSenders();
    const tracks = stream.getTracks();
    
    // Match tracks by kind (video/audio) and replace
    tracks.forEach((track) => {
      const sender = senders.find((s) => s.track && s.track.kind === track.kind);
      if (sender) {
        // Replace existing track of the same kind
        sender.replaceTrack(track).catch((error) => {
          console.error(`Error replacing ${track.kind} track:`, error);
        });
      } else {
        // No sender for this track kind, add it
        this.pc.addTrack(track, stream);
      }
    });
    
    // Remove any senders that don't have a corresponding track in the new stream
    senders.forEach((sender) => {
      if (sender.track) {
        const hasCorrespondingTrack = tracks.some((track) => track.kind === sender.track!.kind);
        if (!hasCorrespondingTrack) {
          this.pc.removeTrack(sender);
        }
      }
    });
  }

  /**
   * Renegotiates the peer connection (creates new offer)
   */
  async renegotiate(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.localOffer = offer;
    return offer;
  }

  /**
   * Creates and returns an offer for peer connection
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.localOffer = await this.pc.createOffer();
    await this.pc.setLocalDescription(this.localOffer);
    return this.localOffer;
  }

  /**
   * Sets remote offer and creates answer
   * Handles both initial connection and renegotiation
   */
  async createAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    // Set the remote description (this will replace any existing one for renegotiation)
    await this.pc.setRemoteDescription(offer);
    
    // Create and set the answer
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    
    return answer;
  }

  /**
   * Sets remote answer to finalize connection
   * Handles both initial connection and renegotiation
   */
  async setAnswer(answer: RTCSessionDescriptionInit) {
    // Only set local description if it hasn't been set yet (for initial connection)
    // For renegotiation, the local description is already set by renegotiate()
    if (this.localOffer && !this.pc.localDescription) {
      await this.pc.setLocalDescription(this.localOffer);
    }
    await this.pc.setRemoteDescription(answer);
  }

  /**
   * Adds ICE candidate to peer connection
   */
  async addIceCandidate(candidate: RTCIceCandidateInit | null) {
    if (candidate) {
      await this.pc.addIceCandidate(candidate);
    }
  }

  /**
   * Returns the remote media stream
   */
  getRemoteStream(): MediaStream | undefined {
    return this.remoteStream;
  }

  /**
   * Closes and cleans up the peer connection
   */
  destroy() {
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((track) => track.stop());
      this.remoteStream = undefined;
    }
    this.pc.close();
    this.removeAllListeners();
  }

  /**
   * Waits for remote stream to become available
   */
  async waitForRemoteStream(timeout: number = 10000): Promise<MediaStream> {
    if (this.remoteStream) {
      return this.remoteStream;
    }

    return new Promise<MediaStream>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Timeout waiting for remote stream'));
      }, timeout);

      const trackHandler = () => {
        if (this.remoteStream) {
          clearTimeout(timeoutId);
          this.pc.removeEventListener('track', trackHandler);
          resolve(this.remoteStream);
        }
      };

      this.pc.addEventListener('track', trackHandler);
    });
  }

  /**
   * Waits for RTC connection to be established
   */
  async waitForConnection(timeout: number = 20000): Promise<void> {
    if (this.pc.connectionState === 'connected') {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Timeout waiting for RTC connection'));
      }, timeout);

      const stateChangeHandler = () => {
        if (this.pc.connectionState === 'connected') {
          clearTimeout(timeoutId);
          this.pc.removeEventListener('connectionstatechange', stateChangeHandler);
          resolve();
        } else if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
          clearTimeout(timeoutId);
          this.pc.removeEventListener('connectionstatechange', stateChangeHandler);
          reject(new Error(`Connection ${this.pc.connectionState}`));
        }
      };

      this.pc.addEventListener('connectionstatechange', stateChangeHandler);
    });
  }

  /**
   * Sets up event listeners for peer connection
   */
  private setupEventListeners() {
    // Handle ICE candidates
    this.pc.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        this.emit('icecandidate', event.candidate);
      }
    });

    // Handle remote tracks
    this.pc.addEventListener('track', (event) => {
      const [stream] = event.streams;
      if (stream) {
        // Only set remote stream if it's actually a remote track
        // Check that the track is not from our local stream
        const track = event.track;
        if (track && track.readyState === 'live') {
          this.remoteStream = stream;
          this.emit('track', stream);
        }
      }
    });

    // Handle connection state changes
    this.pc.addEventListener('connectionstatechange', () => {
      this.emit('connectionstatechange', this.pc.connectionState);
      if (this.pc.connectionState === 'closed' || this.pc.connectionState === 'failed') {
        this.emit('closed');
      }
    });
  }
}

// Legacy exports for backward compatibility
let peerConnection: RTCPeerConnection | null = null;

export const createPeerConnection = (): RTCPeerConnection => {
  peerConnection = new RTCPeerConnection(iceConfig);

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection?.addTrack(track, localStream!);
    });
  }

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('New ICE candidate:', event.candidate);
    }
  };

  peerConnection.ontrack = (event) => {
    console.log('Remote track received:', event.streams[0]);
    if (event.streams && event.streams[0]) {
      const remoteStream = event.streams[0];
      if ((window as any).handleRemoteVideoStream) {
        (window as any).handleRemoteVideoStream(remoteStream);
      }
    }
  };

  return peerConnection;
};

export const createOffer = async (): Promise<RTCSessionDescriptionInit> => {
  if (!peerConnection) {
    throw new Error('Peer connection not initialized');
  }
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  return offer;
};

export const createAnswer = async (
  offer: RTCSessionDescriptionInit
): Promise<RTCSessionDescriptionInit> => {
  if (!peerConnection) {
    throw new Error('Peer connection not initialized');
  }
  await peerConnection.setRemoteDescription(offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  return answer;
};

export const setRemoteDescription = async (answer: RTCSessionDescriptionInit) => {
  if (!peerConnection) {
    throw new Error('Peer connection not initialized');
  }
  await peerConnection.setRemoteDescription(answer);
};

export const addIceCandidate = async (candidate: RTCIceCandidateInit) => {
  if (!peerConnection) {
    throw new Error('Peer connection not initialized');
  }
  await peerConnection.addIceCandidate(candidate);
};

export const closePeerConnection = () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  stopVideo();
};
