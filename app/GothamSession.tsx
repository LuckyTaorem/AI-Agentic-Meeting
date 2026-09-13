'use client';

import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Vapi from '@vapi-ai/web';

export default function GothamSession() {
  const searchParams = useSearchParams();
  const [partnerName, setPartnerName] = useState('Partner');
  
  const [meetingStatus, setMeetingStatus] = useState<'validating' | 'lobby' | 'active' | 'ended' | 'invalid'>('validating');
  const [isLoading, setIsLoading] = useState(false);
  
  // 1. The ground-truth history (deduplicated)
  const [history, setHistory] = useState<{name: string, text: string}[]>([]);
  
  // 2. The temporary live typing streams
  const [liveUserText, setLiveUserText] = useState("");
  const [liveAgentText, setLiveAgentText] = useState("");
  
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  
  const vapiRef = useRef<any>(null);
  const simliRef = useRef<any>(null);
  
  // NEW: Ref to track 15 seconds of silence
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const meetId = searchParams.get('meetId');
    const token = searchParams.get('token');
    const name = searchParams.get('name');

    const meetIdRegex = /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/;

    if (!meetId || !meetIdRegex.test(meetId) || !token || token.length < 10) {
      setMeetingStatus('invalid');
      return;
    }

    if (name) setPartnerName(name);
    setMeetingStatus('lobby');

    vapiRef.current = new Vapi(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY!);

    vapiRef.current.on('call-end', () => {
      endSession();
    });

    return () => {
      vapiRef.current?.stop();
      simliRef.current?.close();
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, [searchParams]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, liveUserText, liveAgentText]); // <-- Watch the new state variables

  // NEW: The smart silence detector
  const resetInactivityTimer = () => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    
    // Set for 15 seconds of silence
    inactivityTimerRef.current = setTimeout(() => {
      if (vapiRef.current && meetingStatus === 'active') {
        console.log("Silence detected. Prompting Sasha to wrap up...");
        
        // Dynamically inject a hidden command telling Sasha to execute the goodbye script
        vapiRef.current.send({
          type: "add-message",
          message: {
            role: "system",
            content: "The user has been completely silent. You must say exactly: 'It looks like there are no more questions. Thank you for your time today, and we look forward to a successful partnership. Have a great day!' and then SILENTLY use your tool to hang up the call immediately."
          }
        });
      }
    }, 15000); 
  };

  const startSession = async () => {
    if (isLoading || meetingStatus === 'active') return;
    setIsLoading(true);

    try {
      const SimliModule = await import('simli-client');
      const SimliClient = SimliModule.SimliClient;
      const generateSimliSessionToken = SimliModule.generateSimliSessionToken;
      const generateIceServers = SimliModule.generateIceServers;

      const tokenResponse = await generateSimliSessionToken({
        apiKey: process.env.NEXT_PUBLIC_SIMLI_API_KEY!,
        config: {
          faceId: process.env.NEXT_PUBLIC_SIMLI_FACE_ID!,
          handleSilence: false, 
          maxSessionLength: 600,
          maxIdleTime: 180,
        },
      });

      const iceServers = await generateIceServers(process.env.NEXT_PUBLIC_SIMLI_API_KEY!);

      simliRef.current = new SimliClient(
        tokenResponse.session_token,
        videoRef.current as HTMLVideoElement,
        audioRef.current as HTMLAudioElement,
        iceServers
      );

      await simliRef.current.start();

      await vapiRef.current.start(process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID, {
        variableValues: { name: partnerName },
      });

      // Start the inactivity timer the moment the call connects
      resetInactivityTimer();

      vapiRef.current.on('audio', (audioElement: HTMLAudioElement) => {
        if (audioElement && audioElement.srcObject) {
          audioElement.muted = true;
          audioElement.play().catch(e => console.warn('Audio play constrained:', e));

          const stream = audioElement.srcObject as MediaStream;
          const audioTrack = stream.getAudioTracks()[0];
          
          if (audioTrack && simliRef.current) {
            simliRef.current.listenToMediastreamTrack(audioTrack);
          }
        }
      });

      vapiRef.current.on('message', (msg: any) => {
        resetInactivityTimer();

        // 1. HANDLE LIVE TYPING (Fast but messy)
        if (msg.type === 'transcript') {
          if (msg.role === 'user') {
            setLiveUserText(msg.transcript);
          } else if (msg.role === 'assistant') {
            setLiveAgentText(msg.transcript);
          }
        }

        // 2. HANDLE FINAL HISTORY (Slightly delayed, but perfect and deduplicated)
        if (msg.type === 'conversation-update' && msg.conversation) {
          const formattedChat = msg.conversation
            .filter((m: any) => m.role === 'user' || m.role === 'assistant')
            .map((m: any) => ({
              name: m.role === 'user' ? partnerName : 'Sasha',
              text: m.content || m.transcript || '...'
            }));
            
          setHistory(formattedChat);
          
          // Clear the live text since the history has caught up
          setLiveUserText("");
          setLiveAgentText("");
        }
      });

      setMeetingStatus('active');
    } catch (error) {
      console.error('Failed to start session:', error);
      alert('Initialization failed. Please ensure your microphone is enabled in the browser settings.');
    } finally {
      setIsLoading(false);
    }
  };

  const endSession = () => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);

    try {
      vapiRef.current?.stop();
    } catch (e) {
      console.error('Vapi stop error:', e);
    }

    try {
      if (simliRef.current && typeof simliRef.current.close === 'function') {
        simliRef.current.close();
      }
    } catch (e) {
      console.error('Simli stop error:', e);
    }

    // Clear the new dual-state variables
    setHistory([]);
    setLiveUserText("");
    setLiveAgentText("");
    
    setMeetingStatus('ended');
  };

  // --------------------------------------------------------
  // UI STATE: INVALID OR EXPIRED SESSION
  // --------------------------------------------------------
  if (meetingStatus === 'invalid') {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center font-sans p-4">
        <div className="max-w-md w-full p-8 border border-zinc-800 bg-zinc-900/50 backdrop-blur-xl rounded-2xl shadow-2xl text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          </div>
          <h2 className="text-2xl font-light tracking-widest text-white uppercase mb-2">Invalid Session</h2>
          <p className="text-zinc-400 text-sm leading-relaxed mb-8">
            The secure meeting identifier provided does not exist, lacks a valid security token, or has expired.
          </p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------
  // UI STATE: SESSION ENDED (Google Meet Style)
  // --------------------------------------------------------
  if (meetingStatus === 'ended') {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center font-sans p-4">
        <div className="max-w-md w-full p-8 border border-zinc-800 bg-zinc-900/50 backdrop-blur-xl rounded-2xl shadow-2xl text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
          <h2 className="text-2xl font-light tracking-widest text-white uppercase mb-2">Session Closed</h2>
          <p className="text-zinc-400 text-sm leading-relaxed mb-8">
            You have securely left the Legacy by Gaurs briefing. Thank you for your time, {partnerName}.
          </p>
          <button 
            onClick={() => window.location.reload()} 
            className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full font-medium transition-colors text-sm uppercase tracking-wider w-full"
          >
            Rejoin Briefing
          </button>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------
  // UI STATE: LOBBY & ACTIVE SESSION
  // --------------------------------------------------------
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8 font-sans selection:bg-amber-500/30">
      <header className="max-w-7xl mx-auto mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-light tracking-widest text-white uppercase">
            Legacy <span className="text-amber-500 font-medium">By Gaurs</span>
          </h1>
          <p className="text-zinc-400 mt-1 text-xs tracking-widest uppercase">
            Meeting ID: {searchParams.get('meetId')} // {partnerName}
          </p>
        </div>
      </header>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 h-[700px]">
        <div className="lg:col-span-2 relative bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl flex items-center justify-center overflow-hidden">
          <audio ref={audioRef} autoPlay className="hidden" />
          <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />

          {meetingStatus === 'lobby' && !isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/80 backdrop-blur-sm z-10">
              <div className="w-20 h-20 mb-6 rounded-full border border-amber-500/30 flex items-center justify-center bg-amber-500/10">
                <svg className="w-8 h-8 text-amber-500 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              </div>
              <button 
                onClick={startSession} 
                className="px-8 py-4 bg-zinc-100 hover:bg-white text-zinc-900 rounded-full font-semibold text-lg transition-all hover:scale-105 shadow-[0_0_40px_-10px_rgba(245,158,11,0.3)]"
              >
                Join Briefing
              </button>
            </div>
          )}

          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 z-10">
              <div className="text-amber-500 font-medium tracking-widest animate-pulse uppercase text-sm">
                Authenticating...
              </div>
            </div>
          )}

          {meetingStatus === 'active' && (
             <button 
               onClick={endSession} 
               className="absolute bottom-6 right-6 px-6 py-3 bg-red-600/80 hover:bg-red-500 text-white rounded-full font-medium backdrop-blur-md transition-colors shadow-xl"
             >
               End Briefing
             </button>
          )}
        </div>

        <div className="bg-zinc-900/40 backdrop-blur-xl border border-zinc-800 rounded-2xl flex flex-col shadow-2xl overflow-hidden">
          <div className="px-6 py-4 bg-zinc-900/80 border-b border-zinc-800 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
            <h3 className="font-medium text-xs tracking-widest uppercase text-zinc-300">Live Transcript</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4 scroll-smooth">
            
            {/* RENDER LOCKED HISTORY */}
            {history.map((msg, idx) => (
              <div key={idx} className={`flex flex-col ${msg.name === 'Sasha' ? 'items-start' : 'items-end'}`}>
                <span className="text-[10px] font-bold tracking-wider uppercase mb-1 text-zinc-500">{msg.name}</span>
                <div className={`px-4 py-3 rounded-2xl text-sm max-w-[85%] leading-relaxed shadow-sm ${msg.name === 'Sasha' ? 'bg-zinc-800/80 text-zinc-200 rounded-tl-sm border border-zinc-700/50' : 'bg-amber-500/10 text-amber-100 rounded-tr-sm border border-amber-500/20'}`}>
                  {msg.text}
                </div>
              </div>
            ))}

            {/* RENDER LIVE TYPING (USER) */}
            {liveUserText && (
              <div className="flex flex-col items-end opacity-70 animate-pulse">
                <span className="text-[10px] font-bold tracking-wider uppercase mb-1 text-zinc-500">{partnerName}</span>
                <div className="px-4 py-3 rounded-2xl text-sm max-w-[85%] leading-relaxed shadow-sm bg-amber-500/10 text-amber-100 rounded-tr-sm border border-amber-500/20">
                  {liveUserText}
                </div>
              </div>
            )}

            {/* RENDER LIVE TYPING (SASHA) */}
            {liveAgentText && (
              <div className="flex flex-col items-start opacity-70 animate-pulse">
                <span className="text-[10px] font-bold tracking-wider uppercase mb-1 text-zinc-500">Sasha</span>
                <div className="px-4 py-3 rounded-2xl text-sm max-w-[85%] leading-relaxed shadow-sm bg-zinc-800/80 text-zinc-200 rounded-tl-sm border border-zinc-700/50">
                  {liveAgentText}
                </div>
              </div>
            )}
            
            {history.length === 0 && !liveUserText && !liveAgentText && meetingStatus === 'active' && (
              <div className="h-full flex items-center justify-center">
                <p className="text-center text-zinc-600 text-xs tracking-widest uppercase animate-pulse">Awaiting voice input...</p>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}