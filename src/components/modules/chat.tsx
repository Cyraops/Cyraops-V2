"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { ArrowLeft, Bot, Check, CheckCheck, FileText, Loader2, MessageSquare, MoreHorizontal, Paperclip, Plus, Search, Send, Users, X } from "lucide-react";
import { Avatar, Button, EmptyState, Field, formatDate, Modal, useToast } from "@/components/ui";
import { CallHeaderControls } from "@/components/calling/call-header-controls";
import { IncomingCallModal, type IncomingCallData } from "@/components/calling/incoming-call-modal";
import { ActiveCallView, type ActiveCallSession } from "@/components/calling/active-call-view";
import { GroupCallStage, type GroupCallSession } from "@/components/calling/group/group-call-stage";
import { GroupIncomingCallModal, type GroupIncomingCallData } from "@/components/calling/group/group-incoming-modal";
import { InChatCallBanner, type ActiveGroupCallSummary } from "@/components/calling/group/in-chat-call-banner";

export function ChatModule() {
  const router=useRouter();const toast=useToast();const[conversations,setConversations]=useState<any[]>([]);const[team,setTeam]=useState<any[]>([]);const[currentUser,setCurrentUser]=useState<any>();const[selectedId,setSelectedId]=useState("");const[messages,setMessages]=useState<any[]>([]);const[query,setQuery]=useState("");const[messageText,setMessageText]=useState("");const[createOpen,setCreateOpen]=useState(false);const[groupEditOpen,setGroupEditOpen]=useState(false);const[mobileShow,setMobileShow]=useState(false);const[busy,setBusy]=useState(false);const[socketReady,setSocketReady]=useState(false);const[loading,setLoading]=useState(true);const[callingReady,setCallingReady]=useState(true);const[callReason,setCallReason]=useState<string|null>(null);const scrollRef=useRef<HTMLDivElement>(null);const socketRef=useRef<Socket|null>(null);const selectedRef=useRef("");const syncedMessageIds=useRef<Record<string,string|null>>({});
  const [activeCall, setActiveCall] = useState<ActiveCallSession | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [rejoinableCall, setRejoinableCall] = useState<ActiveCallSession | null>(null);
  const [groupActiveMeeting, setGroupActiveMeeting] = useState<ActiveGroupCallSummary | null>(null);
  const [groupCallPrompt, setGroupCallPrompt] = useState<{ type: "AUDIO" | "VIDEO" } | null>(null);
  const [ringGroupMembers, setRingGroupMembers] = useState(true);
  const activeCallRef = useRef<ActiveCallSession | null>(null);
  activeCallRef.current = activeCall;
  const incomingCallRef = useRef<IncomingCallData | null>(null);
  incomingCallRef.current = incomingCall;
  const rejoinableCallRef = useRef<ActiveCallSession | null>(null);
  rejoinableCallRef.current = rejoinableCall;
  const currentUserRef = useRef<any>(null);
  currentUserRef.current = currentUser;
  const isRejoiningRef = useRef(false);

  const selected=conversations.find((conversation)=>conversation.id===selectedId);
  const loadConversations=useCallback(async()=>{
    try{
      const[conv,te,me]=await Promise.all([
        fetch("/api/conversations").then(r=>r.ok?r.json():{conversations:[]}).catch(()=>({conversations:[]})),
        fetch("/api/team").then(r=>r.ok?r.json():{members:[]}).catch(()=>({members:[]})),
        fetch("/api/auth/me").then(r=>r.ok?r.json():{user:null}).catch(()=>({user:null})),
      ]);
      setConversations(conv.conversations??[]);setTeam(te.members??[]);setCurrentUser(me.user);currentUserRef.current=me.user;
    }catch(error:any){
      // One failed request used to leave `loading` true forever, which blanked
      // the whole Messages module behind a skeleton with no way out.
      toast(error?.message||"Could not load your messages","error");
    }finally{
      setLoading(false);
    }
  },[]);

  // Active call query & recovery (Stage B)
  const checkActiveCall = useCallback(async (convId: string) => {
    if (!convId || !currentUser?.id) return;
    try {
      const res = await fetch(`/api/calls?conversationId=${convId}&limit=5`);
      if (!res.ok) return;
      const data = await res.json();
      const calls = data.calls || [];
      const currentActive = calls.find(
        (c: any) => c.status === "ACTIVE" || c.status === "CONNECTING" || c.status === "RINGING"
      );
      if (!currentActive) {
        setRejoinableCall(null);
        setGroupActiveMeeting(null);
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("cyraops_active_call_id");
        }
        return;
      }

      if (currentActive.conversation?.type === "GROUP") {
        const hostMember = currentActive.participants?.find((p: any) => p.isHost || p.userId === currentActive.hostId);
        const activeCount = currentActive.participants?.filter((p: any) =>
          p.status === "CONNECTED" || p.status === "CONNECTING" || p.status === "RINGING"
        ).length || 1;
        setGroupActiveMeeting({
          callId: currentActive.id,
          type: currentActive.type,
          hostName: hostMember?.user?.name || "Host",
          participantCount: activeCount,
          startedAt: currentActive.createdAt,
        });
      } else {
        setGroupActiveMeeting(null);
      }

      const myParticipant = currentActive.participants?.find(
        (p: any) => p.userId === currentUser.id
      );
      if (!myParticipant) {
        setRejoinableCall(null);
        return;
      }
      const eligibleStatuses = ["RINGING", "CONNECTING", "CONNECTED", "DISCONNECTED"];
      if (!eligibleStatuses.includes(myParticipant.status)) {
        setRejoinableCall(null);
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("cyraops_active_call_id");
        }
        return;
      }

      if (!activeCallRef.current) {
        const storedCallId = typeof window !== "undefined" ? sessionStorage.getItem("cyraops_active_call_id") : null;
        if (storedCallId === currentActive.id && !isRejoiningRef.current) {
          // Automatic recovery if user refreshed during active call
          setMobileShow(true);
          void handleRejoinCall(currentActive, true);
        } else if (currentActive.conversation?.type === "DIRECT") {
          setRejoinableCall(currentActive);
        }
      }
    } catch {
      // Graceful error handling
    }
  }, [currentUser?.id]);

  const handleJoinGroupCall = async (callId: string) => {
    if (busy || activeCallRef.current) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/calls/${callId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "Could not join call", "error");
        return;
      }
      if (typeof window !== "undefined") {
        sessionStorage.setItem("cyraops_active_call_id", data.call.id);
      }
      setActiveCall(data.call);
      toast("Joined group call", "success");
    } catch (err: any) {
      toast(err?.message || "Failed to join group call", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleRejoinCall = async (callToRejoin: any, silent = false) => {
    if (isRejoiningRef.current || busy || activeCallRef.current) return;
    isRejoiningRef.current = true;
    setBusy(true);
    try {
      const tokenRes = await fetch(`/api/calls/${callToRejoin.id}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        if (!silent) {
          toast(err.error || "Cannot rejoin call: participant not eligible", "error");
        }
        setRejoinableCall(null);
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("cyraops_active_call_id");
        }
        return;
      }
      if (typeof window !== "undefined") {
        sessionStorage.setItem("cyraops_active_call_id", callToRejoin.id);
      }
      setRejoinableCall(null);
      setActiveCall(callToRejoin);
      if (!silent) {
        toast("Reconnected to call", "success");
      }
    } catch (err: any) {
      if (!silent) {
        toast(err?.message || "Failed to rejoin call", "error");
      }
    } finally {
      setBusy(false);
      isRejoiningRef.current = false;
    }
  };

  useEffect(()=>{void loadConversations();const id=new URLSearchParams(window.location.search).get("conversation");if(id)setSelectedId(id);},[loadConversations]);
  useEffect(()=>{let alive=true;fetch("/api/calling/capabilities").then(r=>r.json()).then(d=>{if(!alive)return;setCallingReady(Boolean(d.calling));setCallReason(d.reason??null);}).catch(()=>{});return()=>{alive=false;};},[]);
  useEffect(()=>{selectedRef.current=selectedId;if(!selectedId)return;let alive=true;setMessages([]);fetch(`/api/conversations/${selectedId}/messages`).then(async(r)=>{if(!alive)return;if(!r.ok){setMessages([]);toast(r.status===404?"This conversation is no longer available":"Could not load messages","error");return;}const d=await r.json();setMessages(d.messages??[]);}).catch(()=>{});fetch(`/api/conversations/${selectedId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({read:true})}).then(()=>loadConversations()).catch(()=>{});window.history.replaceState(null,"",`/chat?conversation=${selectedId}`);void checkActiveCall(selectedId);return()=>{alive=false;};},[selectedId,loadConversations,checkActiveCall]);
  useEffect(()=>{const socket=io({autoConnect:true,transports:["websocket","polling"]});socketRef.current=socket;socket.on("connect",()=>{setSocketReady(true);if(selectedRef.current)socket.emit("conversation:join",selectedRef.current);});socket.on("disconnect",()=>setSocketReady(false));socket.on("connect_error",()=>setSocketReady(false));socket.on("message:new",(message:any)=>{if(message.conversationId!==selectedRef.current)return;setMessages((items)=>items.some((item)=>item.id===message.id||item.clientId&&item.clientId===message.clientId)?items:items.concat(message));if(message.senderId!==currentUser?.id){void fetch(`/api/conversations/${message.conversationId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({read:true})});}void loadConversations();});socket.on("conversation:member-removed",(event:any)=>{if(event.userId===currentUser?.id){socket.emit("conversation:leave",event.conversationId);setSelectedId("");selectedRef.current="";setMessages([]);setMobileShow(false);toast("You were removed from this group conversation", "error");router.push("/chat");void loadConversations();}});
socket.on("call:incoming",(data:any)=>{
  if(data.initiator?.id===currentUserRef.current?.id)return;
  if(activeCallRef.current)return;
  setIncomingCall(data);
  if(data.isGroup){
    setGroupActiveMeeting({
      callId: data.callId,
      type: data.type,
      hostName: data.initiator?.name || "Host",
      participantCount: data.participantCount || 1,
    });
  }
});
socket.on("call:state",(data:any)=>{
  // Multi-tab synchronization & In-Chat Group Meeting Banner
  if(data.status==="ENDED"||data.status==="CANCELLED"||data.status==="FAILED"){
    setGroupActiveMeeting((prev)=>prev?.callId===data.callId?null:prev);
  } else if(data.isGroup || (selectedRef.current && data.conversationId === selectedRef.current)){
    const count = data.activeParticipantsCount ?? data.participantCount ?? 1;
    setGroupActiveMeeting((prev) => ({
      callId: data.callId,
      type: data.type || prev?.type || "AUDIO",
      hostName: data.hostName || prev?.hostName || "Host",
      participantCount: count,
      startedAt: prev?.startedAt || new Date().toISOString(),
    }));
  }

  if(incomingCallRef.current&&incomingCallRef.current.callId===data.callId){
    const isGroup = !!(data.isGroup || (incomingCallRef.current as any)?.isGroup);
    const isTerminal = data.status==="ENDED"||data.status==="CANCELLED"||data.status==="FAILED";
    const isAnsweredByOtherInDirect = !isGroup && (
      data.status==="ACTIVE"||(data.status==="CONNECTING"&&data.actorId!==currentUserRef.current?.id&&data.participantStatus==="CONNECTING")
    );
    const isSelfAction = !!(data.actorId && currentUserRef.current?.id && data.actorId === currentUserRef.current.id);
    const isSelfParticipantTransition = isSelfAction && (
      data.participantStatus==="CONNECTING"||
      data.participantStatus==="CONNECTED"||
      data.participantStatus==="DECLINED"||
      data.participantStatus==="LEFT"||
      data.participantStatus==="EJECTED"
    );
    if(isTerminal || isAnsweredByOtherInDirect || isSelfParticipantTransition){
      setIncomingCall(null);
    } else if(isGroup && (data.participantStatus==="CONNECTING"||data.participantStatus==="CONNECTED")){
      setIncomingCall((prev: any) => prev ? { ...prev, participantCount: data.participantCount ?? ((prev.participantCount || 1) + 1) } : null);
    }
  }
  if(rejoinableCallRef.current&&rejoinableCallRef.current.id===data.callId){
    if(data.status==="ENDED"||data.status==="CANCELLED"||data.status==="FAILED"){
      setRejoinableCall(null);
    }
  }
  if(activeCallRef.current&&activeCallRef.current.id===data.callId){
    if(data.status==="ENDED"||data.status==="CANCELLED"||data.status==="FAILED"){
      setActiveCall(null);
      if(typeof window!=="undefined"){
        sessionStorage.removeItem("cyraops_active_call_id");
      }
      toast("Call ended","success");
    }
  }
});return()=>{socket.disconnect();socketRef.current=null;};},[currentUser?.id,loadConversations,router,toast]);
  useEffect(()=>{if(selectedId&&socketReady)socketRef.current?.emit("conversation:join",selectedId);},[selectedId,socketReady]);
  useEffect(()=>{if(!selectedId)return;let alive=true;const sync=async()=>{try{const response=await fetch(`/api/conversations/${selectedId}/messages?limit=100`);if(!response.ok)return;const data=await response.json();if(!alive)return;const latest=data.messages??[];const newestId=latest.at(-1)?.id??null;if(syncedMessageIds.current[selectedId]!==newestId){syncedMessageIds.current[selectedId]=newestId;void loadConversations();}setMessages((items)=>{const pending=items.filter((item)=>item.status==="sending"||item.status==="failed").filter((item)=>!latest.some((message:any)=>message.clientId&&message.clientId===item.clientId));return latest.concat(pending);});if(latest.some((message:any)=>message.senderId!==currentUser?.id&&!message.reads?.some((read:any)=>read.userId===currentUser?.id))){await fetch(`/api/conversations/${selectedId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({read:true})});}}catch{}};void sync();const timer=setInterval(sync,socketReady?8000:3000);return()=>{alive=false;clearInterval(timer);};},[selectedId,socketReady,currentUser?.id,loadConversations]);
  useEffect(()=>{scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:"smooth"});},[messages.length,selectedId]);
  const visible=conversations.filter((item)=>item.label.toLowerCase().includes(query.toLowerCase())||item.members?.some((m:any)=>m.user.name.toLowerCase().includes(query.toLowerCase())));
  const[attachments,setAttachments]=useState<any[]>([]);const[uploading,setUploading]=useState(0);const fileRef=useRef<HTMLInputElement|null>(null);
  const uploadFiles=async(files:FileList|File[]|null)=>{const list=Array.from(files??[]).slice(0,Math.max(0,5-attachments.length));if(!list.length)return;for(const file of list){if(file.size>15*1024*1024){toast(`${file.name} is larger than 15 MB`,"error");continue;}setUploading((n)=>n+1);try{const form=new FormData();form.append("file",file);const response=await fetch("/api/chat/attachments",{method:"POST",body:form});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error??"Could not upload that file");setAttachments((items)=>[...items,result.attachment].slice(0,5));}catch(error:any){toast(error.message,"error");}finally{setUploading((n)=>n-1);}}};
  const handlePaste=(event:React.ClipboardEvent<HTMLTextAreaElement>)=>{const files=Array.from(event.clipboardData?.files??[]);if(files.length){event.preventDefault();void uploadFiles(files);}};
  // `@tasks …` in a message raises a ticket for whoever is named. The message
  // itself is still posted — this is the team's conversation, and the ask belongs
  // in it — but a ticket is created alongside so the request cannot be lost in
  // scrollback.
  const createTicketFromChat = async (text: string) => {
    try {
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        toast(data.error ?? data.message ?? "Could not create that ticket", "error");
        return;
      }
      const owners: Array<{ kind: string; name: string }> = data.ticket?.owners ?? [];
      const waiting: string[] = data.ticket?.awaitingApproval ?? [];
      const unmatched: string[] = data.parsed?.unmatched ?? [];
      const people = owners.map((owner) => (owner.kind === "agent" ? `${owner.name} (AI)` : owner.name)).join(", ");
      toast(
        waiting.length > 0
          ? `Ticket created for ${people || "you"} — the ${waiting.join(", ")} agent needs an owner's approval first`
          : unmatched.length > 0
            ? `Ticket created, but ${unmatched.join(", ")} is not on the team — it went to you`
            : owners.length > 0
              ? `Ticket created for ${people}`
              : "Ticket created"
      );
    } catch {
      toast("Could not create that ticket", "error");
    }
  };

  const send=async(e?:React.FormEvent,retry?:{body:string;clientId:string;attachments?:any[]})=>{e?.preventDefault();const ready=retry?.attachments??attachments;const body=(retry?.body??messageText).trim();if((!body&&ready.length===0)||!selectedId||busy||uploading>0)return;if(!retry){setMessageText("");setAttachments([]);}setBusy(true);const clientId=retry?.clientId??crypto.randomUUID();const pending={id:`pending-${clientId}`,clientId,conversationId:selectedId,senderId:currentUser?.id,body,createdAt:new Date().toISOString(),sender:currentUser,status:"sending",reads:[],attachments:ready.map((file:any)=>({id:file.id,name:file.name,mimeType:file.mimeType,size:file.size}))};setMessages((items)=>items.filter((item)=>item.clientId!==clientId).concat(pending));try{const response=await fetch(`/api/conversations/${selectedId}/messages`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body,clientId,attachmentIds:ready.map((file:any)=>file.id)})});const result=await response.json();if(!response.ok)throw new Error(result.error??"Message could not be sent");setMessages((items)=>items.map((item)=>item.clientId===clientId?result.message:item));void loadConversations();if(!retry&&/(^|\s)@tasks?\b/i.test(body))void createTicketFromChat(body);}catch(error:any){setMessages((items)=>items.map((item)=>item.clientId===clientId?{...item,status:"failed"}:item));setMessageText(body);setAttachments(ready);toast(error.message,"error");}finally{setBusy(false);}};
  const select=(id:string)=>{setSelectedId(id);setMobileShow(true);};
  const start=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=new FormData(event.currentTarget);const type=String(form.get("type"));const memberIds=form.getAll("memberIds").map(String);const name=String(form.get("name")??"");const response=await fetch("/api/conversations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type,...(name.trim()?{name:name.trim()}:{}),memberIds})});const data=await response.json();if(!response.ok)return toast(data.error,"error");await loadConversations();select(data.conversation.id);setCreateOpen(false);toast(type==="GROUP"?"Group conversation created":"Conversation started");};
  const updateGroup=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!selected)return;const form=new FormData(event.currentTarget);const addMemberIds=form.getAll("addMemberIds").map(String);const removeMemberIds=form.getAll("removeMemberIds").map(String);const response=await fetch(`/api/conversations/${selected.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:form.get("name"),addMemberIds,removeMemberIds})});const data=await response.json();if(!response.ok)return toast(data.error,"error");setGroupEditOpen(false);await loadConversations();toast("Group updated");};

  // Client idempotency improvement (Stage H) + Group calling support
  const startCall = async (
    type: "AUDIO" | "VIDEO",
    retryKey?: string,
    options?: { ringAll?: boolean; inviteeIds?: string[] }
  ) => {
    if (!selectedId || busy || activeCall) return;
    if (!callingReady) {
      toast(callReason || "Calling is not configured on this server.", "error");
      return;
    }
    setBusy(true);
    const idempotencyKey = retryKey ?? crypto.randomUUID();
    try {
      const payload: any = { conversationId: selectedId, type };
      if (selected?.type === "GROUP") {
        payload.ringAll = options?.ringAll ?? true;
        if (options?.inviteeIds) payload.inviteeIds = options.inviteeIds;
      }
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "Could not start call", "error");
        return;
      }
      if (typeof window !== "undefined") {
        sessionStorage.setItem("cyraops_active_call_id", data.call.id);
      }
      setActiveCall(data.call);
    } catch (err: any) {
      toast(err?.message || "Failed to initiate call", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleAcceptIncomingCall = async (callData: IncomingCallData | any) => {
    setIncomingCall(null);
    try {
      let res = await fetch(`/api/calls/${callData.callId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok && callData.isGroup) {
        res = await fetch(`/api/calls/${callData.callId}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      }
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "Could not accept call", "error");
        return;
      }
      if (selectedId !== callData.conversationId) {
        select(callData.conversationId);
      }
      if (typeof window !== "undefined") {
        sessionStorage.setItem("cyraops_active_call_id", data.call.id);
      }
      setActiveCall(data.call);
    } catch (err: any) {
      toast(err?.message || "Failed to join call", "error");
    }
  };

  const handleDeclineIncomingCall = async (callData: IncomingCallData) => {
    setIncomingCall(null);
    try {
      await fetch(`/api/calls/${callData.callId}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Declined by user" }),
      });
    } catch {}
  };

  const handleCallEnded = () => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("cyraops_active_call_id");
    }
    setActiveCall(null);
    setRejoinableCall(null);
  };

  const isGroupCall =
    !!activeCall &&
    ((activeCall as any).isGroup === true ||
      (activeCall as any).conversation?.type === "GROUP" ||
      (selected?.id === activeCall.conversationId && selected?.type === "GROUP") ||
      (activeCall.participants && activeCall.participants.length > 2));

  if(loading)return <div className="h-[calc(100vh-130px)] animate-pulse rounded-2xl bg-[var(--hover)]"/>;
  return <div className="-mx-4 -mt-4 overflow-hidden sm:-mx-7 sm:-mt-7 lg:-mx-9"><div className="grid h-[calc(100vh-62px)] min-h-[520px] grid-cols-1 bg-[var(--surface)] lg:grid-cols-[300px_minmax(0,1fr)]">
    <aside className={`${mobileShow?"hidden lg:flex":"flex"} min-h-0 flex-col border-r border-[var(--border)]`}><div className="border-b border-[var(--border)] p-4"><div className="flex items-center justify-between"><div><h1 className="font-display text-lg font-extrabold tracking-tight">Messages</h1><p className="mt-0.5 text-[11px] text-[var(--muted)]">Your team, in real time</p></div><Button variant="secondary" className="h-8 px-2.5" onClick={()=>setCreateOpen(true)}><Plus size={14}/>New</Button></div><div className="relative mt-4"><Search size={14} className="absolute left-3 top-2.5 text-[var(--muted)]"/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search conversations" className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] pl-9 pr-3 text-xs outline-none focus:border-accent"/></div></div><div className="flex items-center justify-between px-4 pb-1 pt-4"><span className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Conversations</span><span className="text-[10px] text-[var(--muted)]">{conversations.length}</span></div><div className="soft-scrollbar flex-1 overflow-y-auto px-2 pb-3">{visible.map((conversation)=>{const other=conversation.members.find((member:any)=>member.userId!==currentUser?.id)?.user;const isGroup=conversation.type==="GROUP";return <button key={conversation.id} onClick={()=>select(conversation.id)} className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-3 text-left transition ${selectedId===conversation.id?"bg-[#f0efff] dark:bg-[#302c4e]":"hover:bg-[var(--hover)]"}`}><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isGroup?"bg-[#e9f5ff] text-sky-700 dark:bg-sky-950/40 dark:text-sky-300":"bg-[#f0efff] text-accent dark:bg-[#302c4e]"}`}>{isGroup?<Users size={15}/>:<span className="text-xs font-bold">{other?.name?.split(" ").map((part:string)=>part[0]).join("").slice(0,2).toUpperCase()??"?"}</span>}</span><span className="min-w-0 flex-1"><span className={`block truncate text-xs ${conversation.unreadCount?"font-bold":"font-semibold"}`}>{conversation.label}</span><span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">{conversation.messages?.[0]?.body??"Start a conversation"}</span></span>{conversation.unreadCount>0&&<span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">{conversation.unreadCount}</span>}</button>})}{!visible.length&&<div className="px-5 py-12 text-center text-xs text-[var(--muted)]">No conversations yet. Start a direct message or group.</div>}</div><div className="border-t border-[var(--border)] px-4 py-3"><span className={`mr-2 inline-block h-2 w-2 rounded-full ${socketReady?"bg-emerald-500":"bg-amber-400"}`}/><span className="text-[10px] text-[var(--muted)]">{socketReady?"Live connection":"Syncing messages"}</span></div></aside>
    <section className={`${mobileShow?"flex":"hidden lg:flex"} min-h-0 flex-col`}>{selected?<><header className="flex h-[68px] items-center gap-3 border-b border-[var(--border)] px-4 sm:px-6"><button className="lg:hidden" onClick={()=>setMobileShow(false)} aria-label="Back"><ArrowLeft size={17}/></button><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f0efff] text-accent">{selected.type==="GROUP"?<Users size={16}/>:<MessageSquare size={15}/>}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm">{selected.label}</b><span className="block truncate text-[10px] text-[var(--muted)]">{selected.members.map((m:any)=>m.user.name).join(", ")}</span></span>
<CallHeaderControls
  disabled={!!activeCall || !callingReady}
  disabledReason={callReason}
  onStartAudioCall={() => {
    if (selected.type === "GROUP") {
      setGroupCallPrompt({ type: "AUDIO" });
    } else {
      void startCall("AUDIO");
    }
  }}
  onStartVideoCall={() => {
    if (selected.type === "GROUP") {
      setGroupCallPrompt({ type: "VIDEO" });
    } else {
      void startCall("VIDEO");
    }
  }}
/>
{selected.type==="GROUP"&&(selected.createdById===currentUser?.id||currentUser?.role!=="MEMBER")&&<Button variant="ghost" className="h-8" onClick={()=>setGroupEditOpen(true)}><MoreHorizontal size={17}/></Button>}
</header>
{activeCall && (
  isGroupCall ? (
    <GroupCallStage
      call={activeCall as any}
      currentUserId={currentUser?.id}
      onCallEnded={handleCallEnded}
    />
  ) : (
    <ActiveCallView
      call={activeCall}
      currentUserId={currentUser?.id}
      onCallEnded={handleCallEnded}
    />
  )
)}
{groupActiveMeeting && selected?.type === "GROUP" && !activeCall && (
  <InChatCallBanner
    call={groupActiveMeeting}
    isUserInCall={!!activeCall}
    onJoin={handleJoinGroupCall}
  />
)}
{rejoinableCall && !activeCall && (
  <div className="flex items-center justify-between border-b border-indigo-200 bg-indigo-50/80 px-4 py-2 text-xs text-indigo-900 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200 sm:px-6">
    <div className="flex items-center gap-2">
      <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
      <span>
        Active {rejoinableCall.type.toLowerCase()} call in progress ({rejoinableCall.participants?.filter((p: any) => p.userId !== currentUser?.id).map((p: any) => p.user?.name).join(", ") || "teammate"})
      </span>
    </div>
    <div className="flex items-center gap-2">
      <Button
        variant="primary"
        className="h-6 px-2.5 text-[11px]"
        onClick={() => void handleRejoinCall(rejoinableCall)}
      >
        Rejoin Call
      </Button>
      <Button
        variant="ghost"
        className="h-6 px-2 text-[11px] text-[var(--muted)]"
        onClick={() => setRejoinableCall(null)}
      >
        Dismiss
      </Button>
    </div>
  </div>
)}
<div ref={scrollRef} className="soft-scrollbar flex-1 overflow-y-auto px-4 py-5 sm:px-8">{messages.length===0?<div className="flex h-full flex-col items-center justify-center text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f0efff] text-accent"><MessageSquare size={22}/></span><h3 className="mt-4 font-display font-bold">Say hello to {selected.label}</h3><p className="mt-1 text-xs text-[var(--muted)]">This is the beginning of your conversation.</p></div>:<div className="mx-auto max-w-3xl space-y-5">{messages.map((message:any,index)=>{const own=message.senderId===currentUser?.id;const isBot=Boolean(message.agent||message.assistant);const authorName=isBot?(message.agent?.name||message.assistant?.name):(message.sender?.name??"You");const previous=messages[index-1];const sameSender=previous&&previous.senderId===message.senderId&&new Date(message.createdAt).getTime()-new Date(previous.createdAt).getTime()<5*60*1000;return <div key={message.id} className={`flex gap-2.5 ${sameSender?"mt-[-10px]":""} ${own?"flex-row-reverse":""}`}><div className="w-8 shrink-0">{!sameSender&&(isBot?<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e9f5ff] text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"><Bot size={15}/></span>:<Avatar name={message.sender?.name??"You"} size="sm" src={message.sender?.avatarUrl}/>)}</div><div className={`max-w-[min(78%,620px)] ${own?"text-right":""}`}>{!sameSender&&<div className={`mb-1 flex items-center gap-2 text-[10px] text-[var(--muted)] ${own?"justify-end":""}`}><b className="text-[var(--text)]">{own?"You":authorName}</b><time>{formatDate(message.createdAt,{hour:"numeric",minute:"2-digit"})}</time></div>}{message.body?<div className={`inline-block whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13px] leading-5 ${own?"rounded-tr-sm bg-accent text-white":"rounded-tl-sm bg-[var(--hover)]"}`}>{message.body}</div>:null}{message.attachments?.length?<div className={`mt-1.5 flex flex-col gap-1.5 ${own?"items-end":"items-start"}`}>{message.attachments.map((file:any)=>{const isImage=String(file.mimeType??"").startsWith("image/");return isImage?<a key={file.id} href={file.url ?? `/api/chat/attachments/${file.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-black/10"><img src={file.url ?? `/api/chat/attachments/${file.id}`} alt={file.name} className="max-h-60 w-auto max-w-full object-cover"/></a>:<a key={file.id} href={`${file.url ?? `/api/chat/attachments/${file.id}`}?download=1`} className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] transition hover:border-accent"><FileText size={15} className="shrink-0 text-accent"/><span className="max-w-[220px] truncate font-medium">{file.name}</span><span className="shrink-0 text-[10px] text-[var(--muted)]">{Math.max(1,Math.round(Number(file.size??0)/1024))} KB</span></a>;})}</div>:null}{own&&<div className="mt-1 flex justify-end text-[9px] text-[var(--muted)]">{message.status==="sending"?"Sending…":message.status==="failed"?<button className="text-rose-600 underline" onClick={()=>void send(undefined,{body:message.body,clientId:message.clientId,attachments:message.attachments??[]})}>Failed · retry</button>:message.reads?.some((read:any)=>read.userId!==currentUser?.id)?<span className="inline-flex items-center gap-1"><CheckCheck size={11}/>Seen</span>:<span className="inline-flex items-center gap-1"><Check size={11}/>Sent</span>}</div>}</div></div>})}</div>}</div><form onSubmit={send} className="border-t border-[var(--border)] px-4 py-4 sm:px-6"><div className="mx-auto max-w-3xl"><div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 focus-within:border-[#aaa3e7]">{(attachments.length>0||uploading>0)&&<div className="mb-2 flex flex-wrap gap-2 px-1">{attachments.map((file:any)=><span key={file.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--hover)] px-2 py-1 text-[11px]">{String(file.mimeType??"").startsWith("image/")?<img src={file.url} alt={file.name} className="h-8 w-8 rounded object-cover"/>:<FileText size={14} className="text-accent"/>}<span className="max-w-[140px] truncate">{file.name}</span><button type="button" onClick={()=>setAttachments((items)=>items.filter((item)=>item.id!==file.id))} className="rounded p-0.5 text-[var(--muted)] transition hover:bg-black/10" aria-label={`Remove ${file.name}`}><X size={12}/></button></span>)}{uploading>0&&<span className="flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-2 py-1 text-[11px] text-[var(--muted)]"><Loader2 size={12} className="animate-spin"/>Uploading…</span>}</div>}<div className="flex items-end gap-2"><input ref={fileRef} type="file" multiple hidden onChange={(e)=>{void uploadFiles(e.target.files);e.target.value="";}}/><button type="button" onClick={()=>fileRef.current?.click()} disabled={attachments.length>=5} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-accent disabled:opacity-40" aria-label="Attach a photo or file" title="Attach up to 5 photos or files (15 MB each)"><Paperclip size={16}/></button><textarea value={messageText} onChange={(e)=>setMessageText(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} onPaste={handlePaste} placeholder="Write a message… @assistant to bring in your bot" maxLength={5000} rows={1} className="max-h-32 min-h-9 flex-1 resize-y bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[var(--muted)]"/><button disabled={(!messageText.trim()&&attachments.length===0)||uploading>0} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition hover:bg-[#5345cc] disabled:opacity-40" aria-label="Send message"><Send size={15}/></button></div></div></div><p className="mx-auto mt-2 max-w-3xl text-[10px] text-[var(--muted)]">Enter to send · Shift + Enter for a new line · 📎 attach photos and files (or paste) · @mention an agent (e.g. @sales, @research) · <b>@tasks</b> to raise a ticket</p></form></>:<div className="flex flex-1 items-center justify-center"><EmptyState icon={<MessageSquare size={22}/>} title="Your team’s conversations" description="Start a direct message or bring a few teammates together in a group." action={<Button onClick={()=>setCreateOpen(true)}><Plus size={14}/>Start a conversation</Button>}/></div>}</section>
  </div><Modal open={createOpen} onClose={()=>setCreateOpen(false)} title="Start a conversation"><form onSubmit={start} className="space-y-4"><div className="grid grid-cols-2 gap-2"><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] p-3 text-xs"><input type="radio" name="type" value="DIRECT" defaultChecked className="accent-accent"/>Direct message</label><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] p-3 text-xs"><input type="radio" name="type" value="GROUP" className="accent-accent"/>Group chat</label></div><Field label="Group name (optional)" name="name" maxLength={100} placeholder="e.g. Design crew"/><div><div className="mb-2 text-xs font-semibold text-[var(--muted)]">Select teammates</div><div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-[var(--border)] p-2">{team.filter((member:any)=>member.id!==currentUser?.id).map((member:any)=><label key={member.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-[var(--hover)]"><input name="memberIds" type="checkbox" value={member.id} className="accent-accent"/><Avatar name={member.name} size="sm"/><span className="flex-1">{member.name}</span><span className="text-[10px] text-[var(--muted)]">{member.role.toLowerCase()}</span></label>)}</div></div><div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={()=>setCreateOpen(false)}>Cancel</Button><Button>Start chat</Button></div></form></Modal>
  <Modal open={groupEditOpen} onClose={()=>setGroupEditOpen(false)} title="Manage group"><form onSubmit={updateGroup} className="space-y-4"><Field label="Group name" name="name" defaultValue={selected?.name??selected?.label} maxLength={100}/><div><div className="mb-2 text-xs font-semibold text-[var(--muted)]">Current members · check to remove</div><div className="max-h-44 overflow-auto rounded-lg border border-[var(--border)] p-2">{selected?.members.filter((member:any)=>member.userId!==selected.createdById).map((member:any)=><label key={member.userId} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-[var(--hover)]"><input type="checkbox" name="removeMemberIds" value={member.userId} className="accent-accent"/><Avatar name={member.user.name} size="sm"/><span>{member.user.name}</span></label>)}</div></div><div><div className="mb-2 text-xs font-semibold text-[var(--muted)]">Add teammates</div><div className="max-h-44 overflow-auto rounded-lg border border-[var(--border)] p-2">{team.filter((member:any)=>member.id!==currentUser?.id&&!selected?.members.some((m:any)=>m.userId===member.id)).map((member:any)=><label key={member.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-[var(--hover)]"><input type="checkbox" name="addMemberIds" value={member.id} className="accent-accent"/><Avatar name={member.name} size="sm"/><span>{member.name}</span></label>)}</div></div><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={()=>setGroupEditOpen(false)}>Cancel</Button><Button>Save changes</Button></div></form></Modal>
  {groupCallPrompt && (
    <Modal
      open={!!groupCallPrompt}
      onClose={() => setGroupCallPrompt(null)}
      title={`Start Group ${groupCallPrompt.type === "VIDEO" ? "Video" : "Audio"} Call`}
    >
      <div className="space-y-4">
        <p className="text-xs text-[var(--muted)]">
          Choose how to initiate the call in <b>{selected?.label}</b>:
        </p>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] p-3 text-xs hover:bg-[var(--hover)] transition">
            <input
              type="radio"
              name="callMode"
              checked={ringGroupMembers}
              onChange={() => setRingGroupMembers(true)}
              className="accent-accent mt-0.5"
            />
            <div>
              <span className="font-semibold block text-[var(--text)]">Ring all members</span>
              <span className="text-[11px] text-[var(--muted)]">
                Rings all {selected?.members?.length || ""} members with incoming call dialog and ringtone.
              </span>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] p-3 text-xs hover:bg-[var(--hover)] transition">
            <input
              type="radio"
              name="callMode"
              checked={!ringGroupMembers}
              onChange={() => setRingGroupMembers(false)}
              className="accent-accent mt-0.5"
            />
            <div>
              <span className="font-semibold block text-[var(--text)]">Open meeting</span>
              <span className="text-[11px] text-[var(--muted)]">
                Starts call immediately and shows a join banner in the chat.
              </span>
            </div>
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={() => setGroupCallPrompt(null)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              const type = groupCallPrompt?.type || "AUDIO";
              setGroupCallPrompt(null);
              void startCall(type, undefined, { ringAll: ringGroupMembers });
            }}
          >
            Start Call
          </Button>
        </div>
      </div>
    </Modal>
  )}
  {(incomingCall as any)?.isGroup ? (
    <GroupIncomingCallModal
      call={incomingCall as any}
      onAccept={handleAcceptIncomingCall}
      onDecline={handleDeclineIncomingCall}
      onDismiss={() => setIncomingCall(null)}
    />
  ) : (
    <IncomingCallModal
      call={incomingCall}
      onAccept={handleAcceptIncomingCall}
      onDecline={handleDeclineIncomingCall}
      onDismiss={() => setIncomingCall(null)}
    />
  )}
</div>;
}
