"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { saveAgentCanvasAction } from "./canvasActions";
import { IconSparkles, IconWrench, IconX, IconCheckCircle, IconAlertTriangle } from "@/components/icons";

type AvailableSkill = { id: string; name: string; description: string };
type InitialAgentSkill = { skillId: string; name: string; description: string; positionX: number; positionY: number };

const centeredHandleStyle = { opacity: 0, top: "50%", left: "50%", transform: "translate(-50%, -50%)" } as const;

function AgentNodeView({ data }: NodeProps<Node<{ name: string; active?: boolean }>>) {
  return (
    <div
      className={`w-28 rounded-xl border-2 bg-white px-2.5 py-2 text-center shadow-md transition-all duration-300 ${
        data.active ? "animate-pulse border-cyan-400 shadow-lg shadow-cyan-300/60" : "border-teal-500"
      }`}
    >
      <Handle type="source" position={Position.Right} style={centeredHandleStyle} />
      <div className="mx-auto mb-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-teal-100 text-teal-600">
        <IconSparkles className="h-3 w-3" />
      </div>
      <p className="truncate text-xs font-semibold text-slate-800">{data.name || "Agent"}</p>
      {data.active && <p className="mt-0.5 text-[9px] font-medium text-cyan-600">思考中…</p>}
    </div>
  );
}

function SkillNodeView({
  data,
}: NodeProps<Node<{ name: string; description: string; active?: boolean; onRemove: () => void }>>) {
  return (
    <div
      className={`group relative w-24 rounded-lg border bg-white px-2 py-1.5 shadow-sm transition-all duration-300 ${
        data.active ? "border-cyan-400 shadow-lg shadow-cyan-300/60 ring-2 ring-cyan-200" : "border-slate-300"
      }`}
    >
      <Handle type="target" position={Position.Left} style={centeredHandleStyle} />
      <button
        type="button"
        onClick={data.onRemove}
        className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white group-hover:flex"
        title="從這個 Agent 移除"
      >
        <IconX className="h-2.5 w-2.5" />
      </button>
      <div className="flex items-center gap-1.5">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
            data.active ? "bg-cyan-100 text-cyan-600" : "bg-slate-100 text-slate-500"
          }`}
        >
          <IconWrench className="h-2.5 w-2.5" />
        </span>
        <p className="truncate text-[11px] font-medium text-slate-700">{data.name}</p>
      </div>
      {data.active && <p className="mt-0.5 text-[9px] font-medium text-cyan-600">執行中…</p>}
    </div>
  );
}

const nodeTypes = { agentNode: AgentNodeView, skillNode: SkillNodeView };

const AGENT_NODE_ID = "agent";
const AGENT_POSITION = { x: 380, y: 220 };

function skillNodeId(skillId: string) {
  return `skill-${skillId}`;
}

function CanvasInner({
  agentId,
  initialName,
  initialSystemPrompt,
  availableSkills,
  initialAgentSkills,
  activeSkillId,
}: {
  agentId: string;
  initialName: string;
  initialSystemPrompt: string;
  availableSkills: AvailableSkill[];
  initialAgentSkills: InitialAgentSkill[];
  activeSkillId: string | null;
}) {
  const [name, setName] = useState(initialName);
  const [systemPrompt, setSystemPrompt] = useState(initialSystemPrompt);
  const [status, setStatus] = useState<{ success?: string; error?: string }>({});
  const [saving, setSaving] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([
    { id: AGENT_NODE_ID, type: "agentNode", position: AGENT_POSITION, data: { name: initialName }, draggable: false },
    ...initialAgentSkills.map((s) => ({
      id: skillNodeId(s.skillId),
      type: "skillNode",
      position: { x: s.positionX, y: s.positionY },
      data: { name: s.name, description: s.description, onRemove: () => removeSkill(s.skillId) },
    })),
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initialAgentSkills.map((s) => ({
      id: `e-${s.skillId}`,
      source: AGENT_NODE_ID,
      target: skillNodeId(s.skillId),
      type: "straight",
    })),
  );

  const removeSkill = useCallback(
    (skillId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== skillNodeId(skillId)));
      setEdges((eds) => eds.filter((e) => e.target !== skillNodeId(skillId)));
    },
    [setNodes, setEdges],
  );

  useEffect(() => {
    const activeNodeId = activeSkillId ? skillNodeId(activeSkillId) : null;
    setNodes((nds) =>
      nds.map((n) => {
        const isActive = n.id === AGENT_NODE_ID ? activeSkillId !== null : n.id === activeNodeId;
        if (n.data.active === isActive) return n;
        return { ...n, data: { ...n.data, active: isActive } };
      }),
    );
    setEdges((eds) =>
      eds.map((e) => {
        const isActive = e.target === activeNodeId;
        if (e.animated === isActive) return e;
        return { ...e, animated: isActive, style: isActive ? { stroke: "#22d3ee", strokeWidth: 2.5 } : undefined };
      }),
    );
  }, [activeSkillId, setNodes, setEdges]);

  const placedSkillIds = new Set(nodes.filter((n) => n.type === "skillNode").map((n) => n.id.replace(/^skill-/, "")));
  const paletteSkills = availableSkills.filter((s) => !placedSkillIds.has(s.id));

  function addSkillNode(skill: AvailableSkill, position: { x: number; y: number }) {
    setNodes((nds) => {
      if (nds.some((n) => n.id === skillNodeId(skill.id))) return nds;
      return [
        ...nds,
        {
          id: skillNodeId(skill.id),
          type: "skillNode",
          position,
          data: { name: skill.name, description: skill.description, onRemove: () => removeSkill(skill.id) },
        },
      ];
    });
    setEdges((eds) => {
      if (eds.some((e) => e.target === skillNodeId(skill.id))) return eds;
      return [...eds, { id: `e-${skill.id}`, source: AGENT_NODE_ID, target: skillNodeId(skill.id), type: "straight" }];
    });
  }

  function handleDragStart(e: React.DragEvent, skill: AvailableSkill) {
    e.dataTransfer.setData("application/json", JSON.stringify(skill));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/json");
    if (!raw || !rfInstance) return;
    const skill = JSON.parse(raw) as AvailableSkill;
    const position = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addSkillNode(skill, position);
  }

  async function handleSave() {
    setSaving(true);
    setStatus({});
    const skills = nodes
      .filter((n) => n.type === "skillNode")
      .map((n) => ({ skillId: n.id.replace(/^skill-/, ""), positionX: n.position.x, positionY: n.position.y }));
    const result = await saveAgentCanvasAction(agentId, { name, systemPrompt, skills });
    setStatus(result);
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">名稱</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">系統提示詞</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={1}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">可用 Skill</h3>
          <p className="mb-3 text-xs text-slate-400">拖曳到右邊畫布，連到 Agent 節點</p>
          <div className="space-y-2">
            {paletteSkills.map((s) => (
              <div
                key={s.id}
                draggable
                onDragStart={(e) => handleDragStart(e, s)}
                className="cursor-grab rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 active:cursor-grabbing"
                title={s.description}
              >
                <span className="flex items-center gap-1.5">
                  <IconWrench className="h-3 w-3 text-slate-400" />
                  {s.name}
                </span>
              </div>
            ))}
            {paletteSkills.length === 0 && <p className="text-xs text-slate-400">沒有可用的 Skill 了</p>}
          </div>
        </div>

        <div
          ref={wrapperRef}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={handleDrop}
          className="h-[420px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm"
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onInit={setRfInstance}
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
        >
          {saving ? "儲存中…" : "儲存"}
        </button>
        {(status.success || status.error) && (
          <p
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${
              status.error ? "bg-rose-50 text-rose-600 ring-rose-100" : "bg-emerald-50 text-emerald-600 ring-emerald-100"
            }`}
          >
            {status.error ? <IconAlertTriangle className="h-4 w-4 shrink-0" /> : <IconCheckCircle className="h-4 w-4 shrink-0" />}
            {status.error ?? status.success}
          </p>
        )}
      </div>
    </div>
  );
}

export function AgentCanvas(props: {
  agentId: string;
  initialName: string;
  initialSystemPrompt: string;
  availableSkills: AvailableSkill[];
  initialAgentSkills: InitialAgentSkill[];
  activeSkillId: string | null;
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
