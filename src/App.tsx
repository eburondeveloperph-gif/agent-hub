import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Search, 
  Plus, 
  Settings, 
  Mic, 
  MicOff, 
  Paperclip, 
  Send, 
  Star, 
  Volume2, 
  MoreVertical,
  ChevronRight,
  MessageSquare,
  Users,
  Layout,
  History,
  Play,
  FileText,
  X,
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  Code,
  RefreshCw,
  CheckCircle2,
  Circle,
  ListTodo
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { Agent, AgentId, Message, MeetingPhase, MeetingState, KnowledgeFile } from './types';
import { AGENTS, AGENT_BG_COLORS, AGENT_BORDER_COLORS } from './constants';
import { NexusLiveClient } from './lib/nexus-live';
import { format } from 'date-fns';
import { AddAgentForm } from './components/AddAgentForm';
import { db } from './lib/db';

const AudioVisualizer = ({ isSpeaking, color }: { isSpeaking: boolean, color: string }) => {
  return (
    <div className="relative w-10 h-10 flex items-center justify-center">
      <AnimatePresence>
        {isSpeaking && (
          <>
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ 
                scale: [1, 1.5, 1.2, 1.8, 1],
                opacity: [0.3, 0.6, 0.4, 0.7, 0.3],
                borderRadius: ["40%", "50%", "45%", "55%", "40%"]
              }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{
                repeat: Infinity,
                duration: 2,
                ease: "easeInOut"
              }}
              className={cn("absolute inset-0 blur-md opacity-30", color.replace('text-', 'bg-'))}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ 
                scale: [1, 1.2, 1.1, 1.3, 1],
                borderRadius: ["30%", "50%", "40%", "60%", "30%"]
              }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{
                repeat: Infinity,
                duration: 1.5,
                ease: "easeInOut"
              }}
              className={cn("absolute inset-2 border-2 opacity-50", color.replace('text-', 'border-'))}
            />
          </>
        )}
      </AnimatePresence>
      <div className={cn("w-3 h-3 rounded-full relative z-10", color.replace('text-', 'bg-'), isSpeaking && "animate-pulse")} />
    </div>
  );
};

interface TodoItem {
  title: string;
  tasks: string[];
  status: 'todo' | 'in-progress' | 'completed';
}

export default function App() {
  // State
  const [agents, setAgents] = useState<Record<AgentId, Agent>>(AGENTS);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [meetingState, setMeetingState] = useState<MeetingState>({
    phase: 'WAIT_FOR_PROMPT',
    currentAgentIndex: -1,
    userPrompt: '',
    isMeetingRunning: false
  });
  const [todoList, setTodoList] = useState<TodoItem[]>([
    { title: "Edge Runtime (Rust/WASM)", tasks: ["Setup Rust env", "Compile WASM modules"], status: "in-progress" },
    { title: "Sync & Messaging", tasks: ["NATS edge-to-edge", "Kafka global sync"], status: "todo" },
    { title: "Security Layer", tasks: ["WireGuard Tunnels", "mTLS for Hubs"], status: "todo" },
    { title: "Infra (K3s/Terraform)", tasks: ["Provision K3s", "VPC Peering"], status: "todo" },
    { title: "UX & Onboarding", tasks: ["3-click Dashboard", "Onboarding Kit"], status: "todo" }
  ]);
  const [activeTab, setActiveTab] = useState<'agents' | 'memory' | 'plan'>('agents');
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);
  const [activeMockup, setActiveMockup] = useState<{ html: string, css: string, js: string, explanation: string } | null>(null);
  const [isPreviewPinned, setIsPreviewPinned] = useState(false);
  
  // Refs
  const liveClientRef = useRef<NexusLiveClient | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Initialize Live Client
  useEffect(() => {
    liveClientRef.current = new NexusLiveClient();
    
    // Load history from DB
    db.getRecentMessages(50).then(msgs => {
      if (msgs.length > 0) {
        setMessages(msgs);
      }
    });

    return () => {
      liveClientRef.current?.close();
    };
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    if (!isPreviewPinned) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isPreviewPinned]);

  // Handlers
  const addMessage = useCallback((msg: Omit<Message, 'id' | 'timestamp'>) => {
    const newMsg: Message = {
      ...msg,
      id: Math.random().toString(36).substring(7),
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMsg]);
    if (!newMsg.isPartial) {
      db.saveMessage(newMsg);
    }
  }, []);

  const handleAddAgent = (newAgent: Agent) => {
    setAgents(prev => ({
      ...prev,
      [newAgent.id]: newAgent
    }));
    addMessage({ type: 'system', content: `Agent "${newAgent.name}" has been added to the hub.` });
  };

  const handleClearHistory = async () => {
    if (window.confirm('Are you sure you want to clear the conversation history? This will remove all messages from the local database.')) {
      await db.clearHistory();
      setMessages([]);
      addMessage({ type: 'system', content: 'Conversation history cleared.' });
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    const text = inputText;
    setInputText('');
    addMessage({ type: 'user', content: text });

    if (meetingState.phase === 'WAIT_FOR_PROMPT') {
      startMeeting(text);
    } else {
      // Send to active agent if any
      await liveClientRef.current?.sendText(text);
    }
  };

  const getContextPrompt = () => {
    let context = "";
    if (knowledgeFiles.length > 0) {
      context += "\n\nShared Knowledge Base Files:\n";
      knowledgeFiles.forEach(f => {
        context += `- ${f.name} (${f.type}): ${f.content.substring(0, 1000)}${f.content.length > 1000 ? '...' : ''}\n`;
      });
    }
    return context;
  };

  const startMeeting = async (prompt: string) => {
    const fullPrompt = prompt + getContextPrompt();
    setMeetingState(prev => ({
      ...prev,
      phase: 'WELCOME',
      userPrompt: fullPrompt,
      isMeetingRunning: true
    }));

    addMessage({ type: 'system', content: `Meeting started: "${prompt}"` });
    
    // Orchestration logic would go here
    // For now, let's simulate the flow
    runMeetingFlow(fullPrompt);
  };

  const runMeetingFlow = async (prompt: string) => {
    const expertIds: AgentId[] = ['zeus', 'aquiles', 'orbit', 'echo', 'master', 'atlas', 'forge', 'nova', 'nexus'];
    const anchor = agents['maximus'];
    
    // Helper to connect and speak
    const agentSpeak = async (agent: Agent, textPrompt: string, agentId: AgentId, phaseName?: string) => {
      let audioFinished = false;
      
      // Update meeting state phase if provided
      if (phaseName) {
        setMeetingState(prev => ({ ...prev, phase: phaseName as MeetingPhase }));
      }

      // Get recent history from DB for context
      const history = await db.getRecentMessages(20);

      await liveClientRef.current?.connect(agent, {
        onTranscription: (text, isUser) => {
          if (isUser) handleUserTranscription(text);
          else handleAgentTranscription(agentId, agent.name, text);
        },
        onToolCall: (name, args) => handleToolCall(agentId, name, args),
        onAudioEnd: () => { 
          audioFinished = true; 
          completeLastMessage();
        }
      }, history);

      await liveClientRef.current?.sendText(textPrompt);
      while (!audioFinished) await new Promise(r => setTimeout(r, 500));
      completeLastMessage();
      setAgents(prev => ({ ...prev, [agentId]: { ...prev[agentId], status: 'idle' } }));
    };

    // Phase 1: Welcome & Self-Intro (Maximus)
    setAgents(prev => ({ ...prev, maximus: { ...prev.maximus, status: 'speaking' } }));
    await agentSpeak(
      anchor,
      `As the Meeting Anchor, give a short, high-energy intro of yourself (Maximus). Mention you're from EBuron AI (eburon.ai) and use some Pinoy expressions. Then, ask every participant in the room to quickly introduce themselves and their role.`,
      'maximus',
      'WELCOME'
    );

    // Phase 2: Participant Intros (Round Robin)
    setMeetingState(prev => ({ ...prev, phase: 'INTRODUCTIONS' }));
    for (const id of expertIds) {
      setAgents(prev => ({ ...prev, [id]: { ...prev[id], status: 'speaking' } }));
      await agentSpeak(
        agents[id],
        `Give a very brief (1 sentence) introduction of yourself as ${agents[id].name}, the ${agents[id].role} at EBuron AI.`,
        id
      );
    }

    // Phase 3: Project Overview (Maximus)
    setAgents(prev => ({ ...prev, maximus: { ...prev.maximus, status: 'speaking' } }));
    await agentSpeak(
      anchor,
      `Salamat everyone! Now, listen up po. Master E (the user) has given us a challenge: "${prompt}". Give a detailed project overview of this Multi-Agent Edge Intelligence system. Explain the core requirements and the high stakes for EBuron AI. Then, ask the panel to start sharing their deep technical thoughts on how they will approach this based on their persona and skills.`,
      'maximus',
      'FIRST_IMPRESSIONS'
    );

    // Phase 4: Discussion Loop
    const spokenAgents = new Set<AgentId>();
    let argumentTriggered = false;
    let marketImpactTriggered = false;

    while (spokenAgents.size < expertIds.length) {
      // Randomly trigger a quick interjection from a random agent (not the one about to speak)
      if (Math.random() > 0.6 && spokenAgents.size > 0) {
        const interjectorId = expertIds[Math.floor(Math.random() * expertIds.length)];
        const interjector = agents[interjectorId];
        setAgents(prev => ({ ...prev, [interjectorId]: { ...prev[interjectorId], status: 'speaking' } }));
        await agentSpeak(
          interjector, 
          "Give a very short, one-sentence lively interjection or acknowledgment based on the current conversation. Be funny or passionate!", 
          interjectorId
        );
      }

      // Simulate agents raising hands
      const availableAgents = expertIds.filter(id => !spokenAgents.has(id));
      const raisingHands = availableAgents.filter(() => Math.random() > 0.3);
      if (raisingHands.length === 0 && availableAgents.length > 0) raisingHands.push(availableAgents[0]);

      setAgents(prev => {
        const next = { ...prev };
        raisingHands.forEach(id => { next[id] = { ...next[id], isHandRaised: true }; });
        return next;
      });

      await new Promise(r => setTimeout(r, 500)); // Reduced from 1500

      const pickedId = raisingHands[Math.floor(Math.random() * raisingHands.length)];
      const pickedAgent = agents[pickedId];
      
      // Clear hand raised status
      setAgents(prev => {
        const next = { ...prev };
        raisingHands.forEach(id => { next[id] = { ...next[id], isHandRaised: false }; });
        next[pickedId] = { ...next[pickedId], status: 'speaking' };
        return next;
      });

      let thoughtPrompt = `As ${pickedAgent.role}, share your specific technical approach to "${prompt}". Focus on ${pickedAgent.expertise}. Keep it concise and actionable.`;
      
      // Inject Argument or Market Impact logic
      if (!argumentTriggered && spokenAgents.size >= 2 && Math.random() > 0.5) {
        thoughtPrompt += " Also, respectfully disagree or challenge a previous point to ensure we're considering all risks. Keep it brief.";
        argumentTriggered = true;
        setMeetingState(prev => ({ ...prev, phase: 'DEBATE' }));
      } else if (!marketImpactTriggered && spokenAgents.size >= 4 && Math.random() > 0.5) {
        thoughtPrompt += " Additionally, briefly explain the market impact of this implementation.";
        marketImpactTriggered = true;
        setMeetingState(prev => ({ ...prev, phase: 'RISK_ASSESSMENT' }));
      }

      await agentSpeak(pickedAgent, thoughtPrompt, pickedId);
      spokenAgents.add(pickedId);
      
      // Anchor (Maximus) acknowledges and asks for next
      if (spokenAgents.size < expertIds.length) {
        setAgents(prev => ({ ...prev, maximus: { ...prev.maximus, status: 'speaking' } }));
        await agentSpeak(
          anchor,
          `Thanks ${pickedAgent.name}. Who's next?`,
          'maximus'
        );
      }
    }

    // Phase 5: Synthesis (Master)
    setMeetingState(prev => ({ ...prev, phase: 'SYNTHESIS' }));
    addMessage({ type: 'system', content: "Meeting concluding: Master is synthesizing the final production-level solution." });
    
    setAgents(prev => ({ ...prev, master: { ...prev.master, status: 'speaking' } }));
    await agentSpeak(
      agents['master'],
      `As the CTO, synthesize all the points discussed into a final, production-level implementation plan for the Multi-Agent Edge Intelligence system. Be decisive and clear on the final tech stack and architecture. Update the Project To-Do List using the update_todo_list tool to reflect the final plan.`,
      'master'
    );
  };

  const completeLastMessage = () => {
    setMessages(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (!last.isPartial) return prev;
      const completed = { ...last, isPartial: false };
      db.saveMessage(completed);
      return [...prev.slice(0, -1), completed];
    });
  };

  const handleToolCall = (agentId: AgentId, name: string, args: any) => {
    if (name === 'generate_mockup') {
      setActiveMockup({
        html: args.html,
        css: args.css,
        js: args.js || '',
        explanation: args.explanation
      });
      setIsPreviewPinned(true);
      addMessage({
        type: 'system',
        content: `${agents[agentId].name} generated a UI mockup: ${args.explanation}`
      });
    } else if (name === 'update_todo_list') {
      setTodoList(args.todoList);
      addMessage({
        type: 'system',
        content: `${agents[agentId].name} updated the Project To-Do List.`
      });
    }
  };

  const handleUserTranscription = (text: string) => {
    setMessages(prev => {
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && lastMsg.type === 'user') {
        return [...prev.slice(0, -1), { ...lastMsg, content: lastMsg.content + text, isPartial: true }];
      } else {
        return [...prev, {
          id: Math.random().toString(36).substring(7),
          type: 'user',
          content: text,
          timestamp: new Date(),
          isPartial: true
        }];
      }
    });
  };

  const handleAgentTranscription = (agentId: AgentId, agentName: string, text: string) => {
    setMessages(prev => {
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && lastMsg.type === 'agent' && lastMsg.agentId === agentId) {
        return [...prev.slice(0, -1), { ...lastMsg, content: lastMsg.content + text, isPartial: true }];
      } else {
        return [...prev, {
          id: Math.random().toString(36).substring(7),
          type: 'agent',
          agentId: agentId,
          agentName: agentName,
          content: text,
          timestamp: new Date(),
          isPartial: true
        }];
      }
    });
  };

  const toggleMic = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        mediaRecorderRef.current = mediaRecorder;
        
        mediaRecorder.ondataavailable = async (event) => {
          if (event.data.size > 0) {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = (reader.result as string).split(',')[1];
              liveClientRef.current?.sendAudio(base64);
            };
            reader.readAsDataURL(event.data);
          }
        };

        mediaRecorder.start(500);
        setIsRecording(true);
      } catch (err) {
        console.error("Mic error:", err);
      }
    }
  };

  return (
    <div className="flex h-screen bg-[#09090b] text-[#fafafa] font-sans selection:bg-zinc-700">
      {/* Left Sidebar */}
      <aside className="w-72 border-r border-zinc-800 flex flex-col bg-[#09090b]">
        <div className="p-6 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 bg-zinc-100 rounded-lg flex items-center justify-center">
            <Layout className="w-5 h-5 text-zinc-900" />
          </div>
          <h1 className="font-bold text-lg tracking-tight">Eburon Agents Hub</h1>
        </div>

        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Search chats..." 
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-700 transition"
            />
          </div>

          <button className="w-full flex items-center justify-between p-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl transition group">
            <div className="flex items-center gap-3">
              <Plus className="w-4 h-4 text-zinc-400 group-hover:text-white" />
              <span className="text-sm font-medium">Start New Chat</span>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-600" />
          </button>

          <div className="pt-4">
            <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 px-2">History</h2>
            <div className="space-y-1">
              {[1, 2, 3].map(i => (
                <button key={i} className="w-full flex items-center gap-3 p-2 hover:bg-zinc-900 rounded-lg transition text-left group">
                  <History className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400" />
                  <span className="text-sm text-zinc-400 group-hover:text-zinc-200 truncate">Previous Discussion {i}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-6">
            <div className="flex items-center gap-2 px-2 mb-4">
              <ListTodo className="w-3 h-3 text-blue-500" />
              <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Project To-Do List</h2>
            </div>
            <div className="space-y-4 px-2">
              {todoList.map((item, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="flex items-center gap-2">
                    {item.status === 'completed' ? (
                      <CheckCircle2 className="w-3 h-3 text-green-500" />
                    ) : item.status === 'in-progress' ? (
                      <div className="w-3 h-3 rounded-full border border-blue-500 border-t-transparent animate-spin" />
                    ) : (
                      <Circle className="w-3 h-3 text-zinc-700" />
                    )}
                    <span className="text-[11px] font-bold text-zinc-300">{item.title}</span>
                  </div>
                  <div className="pl-5 space-y-1">
                    {item.tasks.map((task, tIdx) => (
                      <div key={tIdx} className="flex items-center gap-2 group cursor-pointer">
                        <div className="w-1 h-1 rounded-full bg-zinc-800 group-hover:bg-zinc-600 transition" />
                        <span className="text-[10px] text-zinc-500 group-hover:text-zinc-400 transition">{task}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-zinc-800">
          <button className="w-full flex items-center gap-3 p-3 hover:bg-zinc-900 rounded-xl transition text-zinc-400 hover:text-white">
            <Settings className="w-4 h-4" />
            <span className="text-sm font-medium">Settings</span>
          </button>
        </div>
      </aside>

      {/* Center Chat */}
      <main className="flex-1 flex flex-col relative">
        {/* Activity Header */}
        <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-6 bg-[#09090b]/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <div className="flex -space-x-2">
              {Object.values(agents).map((agent: Agent) => (
                <div 
                  key={agent.id}
                  className={cn(
                    "w-6 h-6 rounded-full border-2 border-[#09090b] flex items-center justify-center text-[10px] font-bold text-white transition-transform hover:scale-110 overflow-hidden",
                    AGENT_BG_COLORS[agent.id] || "bg-zinc-700",
                    agent.status === 'speaking' && "ring-2 ring-white animate-pulse"
                  )}
                >
                  {agent.avatar ? (
                    <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
                  ) : (
                    agent.initial
                  )}
                </div>
              ))}
            </div>
            <div className="h-4 w-px bg-zinc-800" />
            <div className="flex flex-col">
              <span className="text-xs font-bold text-zinc-200">Active Meeting</span>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{meetingState.phase.replace(/_/g, ' ')}</span>
            </div>
            {(Object.values(agents) as Agent[]).some(a => a.status === 'speaking') && (
              <div className="ml-2">
                <AudioVisualizer 
                  isSpeaking={true} 
                  color={(Object.values(agents) as Agent[]).find(a => a.status === 'speaking')?.color || 'text-white'} 
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tight">Live Connected</span>
            </div>
            <button 
              onClick={handleClearHistory}
              className="p-2 hover:bg-zinc-900 rounded-full transition text-zinc-400 hover:text-red-400"
              title="Clear History"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button className="p-2 hover:bg-zinc-900 rounded-full transition text-zinc-400 hover:text-white">
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Messages Area */}
          <div className={cn(
            "flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide transition-all duration-500",
            activeMockup && "border-r border-zinc-800"
          )}>
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-6">
                <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center border border-zinc-800 shadow-2xl">
                  <MessageSquare className="w-10 h-10 text-zinc-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-2">Welcome to Nexus AI</h2>
                  <p className="text-sm text-zinc-500">Provide an initial prompt to start a collaborative discussion with 8 specialized AI agents.</p>
                </div>
                <div className="grid grid-cols-2 gap-3 w-full">
                  {['System Architecture', 'UX Strategy', 'Risk Analysis', 'DevOps Roadmap'].map(topic => (
                    <button 
                      key={topic}
                      onClick={() => setInputText(`Let's discuss ${topic}`)}
                      className="p-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-400 hover:text-white transition text-left"
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex items-start gap-4",
                    msg.type === 'user' ? "flex-row-reverse" : "flex-row",
                    msg.type === 'system' && "justify-center"
                  )}
                >
                  {msg.type === 'system' ? (
                    <div className="bg-yellow-500/10 border border-yellow-500/20 px-4 py-2 rounded-full flex items-center gap-3">
                      <p className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest">{msg.content}</p>
                      {msg.content.includes('mockup') && (
                        <button 
                          onClick={() => setIsPreviewPinned(true)}
                          className="p-1 hover:bg-yellow-500/20 rounded text-yellow-500 transition"
                        >
                          <Layout className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 shadow-lg",
                        msg.type === 'user' ? "bg-blue-600" : (msg.agentId ? AGENT_BG_COLORS[msg.agentId] : "bg-zinc-800")
                      )}>
                        {msg.type === 'user' ? 'U' : (msg.agentId ? agents[msg.agentId].initial : 'AI')}
                      </div>
                      <div className={cn(
                        "max-w-[80%] rounded-2xl px-4 py-3 shadow-sm relative",
                        msg.type === 'user' ? "bg-blue-600 text-white" : "bg-zinc-900 border border-zinc-800 text-zinc-200"
                      )}>
                        {msg.isPartial && (
                          <div className="absolute -top-2 -right-2 bg-zinc-800 border border-zinc-700 rounded-full px-2 py-0.5 flex items-center gap-1 shadow-lg z-10">
                            <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
                            <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-tighter">Live</span>
                          </div>
                        )}
                        {msg.type === 'agent' && (
                          <p className={cn("text-[10px] font-bold uppercase tracking-wider mb-1", msg.agentId && agents[msg.agentId].color)}>
                            {msg.agentName}
                          </p>
                        )}
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        <p className="text-[9px] opacity-40 mt-2 font-mono">{format(msg.timestamp, 'HH:mm:ss')}</p>
                      </div>
                    </>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={chatEndRef} />
          </div>

          {/* Mockup Area */}
          <AnimatePresence>
            {activeMockup && (
              <motion.div 
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: '50%', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                className="bg-zinc-950 flex flex-col border-l border-zinc-800 overflow-hidden"
              >
                <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/30">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg">
                      <Code className="w-4 h-4 text-blue-500" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">Live Mockup Rendering</h3>
                      <p className="text-[10px] text-zinc-500 truncate max-w-[200px]">{activeMockup.explanation}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        const current = activeMockup;
                        setActiveMockup(null);
                        setTimeout(() => setActiveMockup(current), 10);
                      }} 
                      className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition"
                      title="Refresh Preview"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => setActiveMockup(null)} 
                      className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-red-500 transition"
                      title="Close Preview"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 bg-white relative">
                  <iframe 
                    key={JSON.stringify(activeMockup)}
                    title="mockup-preview"
                    srcDoc={`
                      <html>
                        <head>
                          <script src="https://cdn.tailwindcss.com"></script>
                          <style>${activeMockup.css}</style>
                        </head>
                        <body class="bg-white">
                          ${activeMockup.html}
                          <script>${activeMockup.js}</script>
                        </body>
                      </html>
                    `}
                    className="w-full h-full border-none"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Input Area */}
        <div className="p-6 bg-gradient-to-t from-[#09090b] via-[#09090b] to-transparent">
          <div className="max-w-4xl mx-auto relative">
            <div className="bg-[#18181b] border border-zinc-800 rounded-2xl p-2 shadow-2xl focus-within:ring-1 focus-within:ring-zinc-700 transition-all">
              <textarea 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={meetingState.phase === 'WAIT_FOR_PROMPT' ? "Enter meeting prompt to start..." : "Message the panel..."}
                className="w-full bg-transparent border-none focus:ring-0 text-sm p-3 resize-none h-24 placeholder:text-zinc-600"
              />
              <div className="flex items-center justify-between px-2 pb-1">
                <div className="flex items-center gap-1">
                  <label className="cursor-pointer p-2 hover:bg-zinc-800 rounded-lg transition text-zinc-500 hover:text-zinc-300">
                    <input 
                      type="file" 
                      className="hidden" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            const newFile: KnowledgeFile = {
                              id: Math.random().toString(36).substring(7),
                              name: file.name,
                              type: file.type,
                              size: file.size,
                              content: ev.target?.result as string
                            };
                            setKnowledgeFiles(prev => [...prev, newFile]);
                            addMessage({ type: 'system', content: `Knowledge Base updated: Added ${file.name}` });
                          };
                          reader.readAsText(file);
                        }
                      }}
                    />
                    <Paperclip className="w-4 h-4" />
                  </label>
                  <button 
                    onClick={toggleMic}
                    className={cn(
                      "p-2 rounded-lg transition flex items-center gap-2",
                      isRecording ? "bg-red-500/20 text-red-500" : "hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    {isRecording ? <Mic className="w-4 h-4 animate-pulse" /> : <Mic className="w-4 h-4" />}
                    {isRecording && <span className="text-[10px] font-bold uppercase tracking-tighter">Recording</span>}
                  </button>
                </div>
                <button 
                  onClick={handleSendMessage}
                  disabled={!inputText.trim()}
                  className="bg-white text-black p-2 rounded-xl hover:bg-zinc-200 disabled:opacity-50 disabled:hover:bg-white transition-all shadow-lg"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
            {meetingState.phase === 'WAIT_FOR_PROMPT' && (
              <div className="absolute -top-10 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-full">
                <Play className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                <span className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest">Awaiting Initial Prompt</span>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Right Sidebar */}
      <aside className="w-96 border-l border-zinc-800 flex flex-col bg-[#09090b]">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex bg-zinc-900 p-1 rounded-xl w-full">
            {(['agents', 'memory', 'plan'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition",
                  activeTab === tab ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'agents' && (
            <div className="space-y-3">
              <AddAgentForm onAdd={handleAddAgent} />
              <div className="flex items-center justify-between px-2 mb-4">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Expert Panel</h3>
                <span className="text-[10px] font-bold text-zinc-600">{Object.keys(agents).length} ACTIVE</span>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {Object.values(agents).map((agent: Agent) => (
                  <motion.div 
                    key={agent.id}
                    whileHover={{ scale: 1.02 }}
                    className={cn(
                      "p-4 rounded-2xl border transition-all cursor-pointer group relative overflow-hidden",
                      agent.status === 'speaking' 
                        ? cn("bg-zinc-900 border-2", AGENT_BORDER_COLORS[agent.id] || "border-zinc-500/50") 
                        : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
                    )}
                  >
                    {agent.status === 'speaking' && (
                      <div className={cn("absolute top-0 left-0 w-1 h-full", AGENT_BG_COLORS[agent.id] || "bg-zinc-500")} />
                    )}
                    
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <div className={cn(
                          "w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold text-white shadow-xl overflow-hidden",
                          AGENT_BG_COLORS[agent.id] || "bg-zinc-700"
                        )}>
                          {agent.avatar ? (
                            <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
                          ) : (
                            agent.initial
                          )}
                        </div>
                        <div className="absolute -top-1 -right-1 bg-yellow-500 rounded-full p-1 border-2 border-[#09090b]">
                          <Star className="w-2 h-2 text-black fill-black" />
                        </div>
                        {agent.status === 'speaking' && (
                          <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-1 border-2 border-[#09090b] animate-pulse">
                            <Volume2 className="w-2 h-2 text-white" />
                          </div>
                        )}
                        {agent.isHandRaised && (
                          <div className="absolute -top-1 -left-1 bg-blue-500 rounded-full p-1 border-2 border-[#09090b] animate-bounce">
                            <Users className="w-2 h-2 text-white" />
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h4 className={cn("text-xs font-bold tracking-wide uppercase", agent.color.startsWith('#') ? "" : agent.color)} style={agent.color.startsWith('#') ? { color: agent.color } : {}}>
                            {agent.name}
                          </h4>
                          <div className="flex items-center gap-2">
                            {agent.status === 'speaking' && (
                              <AudioVisualizer isSpeaking={true} color={AGENT_BG_COLORS[agent.id] || "bg-zinc-500"} />
                            )}
                            <div className={cn(
                              "w-2 h-2 rounded-full",
                              agent.status === 'speaking' ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-zinc-700"
                            )} />
                          </div>
                        </div>
                        <p className="text-[10px] text-zinc-500 font-medium uppercase mt-0.5">{agent.role}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col">
                          <span className="text-[8px] font-bold text-zinc-600 uppercase">Power</span>
                          <span className="text-xs font-mono font-bold text-white">{agent.powerLevel}</span>
                        </div>
                        <div className="h-6 w-px bg-zinc-800" />
                        <div className="flex flex-col">
                          <span className="text-[8px] font-bold text-zinc-600 uppercase">Status</span>
                          <span className={cn(
                            "text-[10px] font-bold uppercase",
                            agent.status === 'speaking' ? "text-green-500" : "text-zinc-500"
                          )}>
                            {agent.status}
                          </span>
                        </div>
                      </div>
                      <button className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition group-hover:scale-110">
                        <Volume2 className="w-3.5 h-3.5 text-zinc-400" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'memory' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Shared Knowledge</h3>
                <label className="cursor-pointer">
                  <input 
                    type="file" 
                    className="hidden" 
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          const newFile: KnowledgeFile = {
                            id: Math.random().toString(36).substring(7),
                            name: file.name,
                            type: file.type,
                            size: file.size,
                            content: ev.target?.result as string
                          };
                          setKnowledgeFiles(prev => [...prev, newFile]);
                          addMessage({ type: 'system', content: `Knowledge Base updated: Added ${file.name}` });
                        };
                        reader.readAsText(file);
                      }
                    }}
                  />
                  <div className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition">
                    <Plus className="w-3 h-3 text-white" />
                  </div>
                </label>
              </div>
              
              <div className="space-y-2">
                {knowledgeFiles.length === 0 ? (
                  <div className="p-8 text-center border-2 border-dashed border-zinc-800 rounded-2xl">
                    <FileText className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
                    <p className="text-[10px] text-zinc-600 font-bold uppercase">No files uploaded</p>
                  </div>
                ) : (
                  knowledgeFiles.map(file => (
                    <div key={file.id} className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center gap-3 group">
                      <div className="w-8 h-8 bg-zinc-800 rounded-lg flex items-center justify-center">
                        <FileText className="w-4 h-4 text-zinc-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold text-zinc-300 truncate uppercase">{file.name}</p>
                        <p className="text-[8px] text-zinc-600 font-bold uppercase">{(file.size / 1024).toFixed(1)} KB</p>
                      </div>
                      <button 
                        onClick={() => setKnowledgeFiles(prev => prev.filter(f => f.id !== file.id))}
                        className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {activeMockup && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-2">
                    <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Active Mockup</h3>
                    <button 
                      onClick={() => setIsPreviewPinned(!isPreviewPinned)}
                      className={cn(
                        "p-1.5 rounded-lg transition",
                        isPreviewPinned ? "bg-blue-500/20 text-blue-500" : "bg-zinc-800 text-zinc-500"
                      )}
                    >
                      {isPreviewPinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                    </button>
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
                    <div className="p-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 rounded-full bg-red-500/50" />
                          <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
                          <div className="w-2 h-2 rounded-full bg-green-500/50" />
                        </div>
                        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-tighter">Live Preview</span>
                      </div>
                      <button onClick={() => setActiveMockup(null)} className="text-zinc-600 hover:text-white transition">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="aspect-video bg-white relative">
                      <iframe 
                        title="mockup-preview"
                        srcDoc={`
                          <html>
                            <head>
                              <style>${activeMockup.css}</style>
                            </head>
                            <body>
                              ${activeMockup.html}
                              <script>${activeMockup.js}</script>
                            </body>
                          </html>
                        `}
                        className="w-full h-full border-none"
                      />
                    </div>
                    <div className="p-3 bg-zinc-900/50 border-t border-zinc-800">
                      <p className="text-[9px] text-zinc-400 leading-relaxed italic">"{activeMockup.explanation}"</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'plan' && (
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest px-2">Meeting Roadmap</h3>
              <div className="space-y-2">
                {[
                  { phase: 'Introductions', status: 'completed' },
                  { phase: 'Deep Dive: Models', status: 'active' },
                  { phase: 'Deep Dive: Stack', status: 'pending' },
                  { phase: 'Risk Assessment', status: 'pending' },
                  { phase: 'Synthesis', status: 'pending' },
                ].map((step, i) => (
                  <div key={i} className={cn(
                    "p-3 rounded-xl border flex items-center gap-3 transition",
                    step.status === 'active' ? "bg-zinc-900 border-zinc-700" : "bg-transparent border-zinc-800 opacity-50"
                  )}>
                    <div className={cn(
                      "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                      step.status === 'completed' ? "bg-green-500 text-white" : 
                      step.status === 'active' ? "bg-white text-black" : "bg-zinc-800 text-zinc-500"
                    )}>
                      {i + 1}
                    </div>
                    <span className="text-xs font-medium">{step.phase}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-zinc-800">
          <button 
            disabled={meetingState.isMeetingRunning}
            onClick={() => {
              const prompt = inputText || "Start general discussion";
              setInputText('');
              startMeeting(prompt);
            }}
            className="w-full py-3 bg-white text-black rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-zinc-200 transition-all disabled:opacity-50 shadow-xl"
          >
            {meetingState.isMeetingRunning ? "Meeting in Progress" : "Start Meeting Flow"}
          </button>
        </div>
      </aside>
    </div>
  );
}
