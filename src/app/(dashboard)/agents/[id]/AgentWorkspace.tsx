"use client";

import { useState } from "react";
import { AgentCanvas } from "./AgentCanvas";
import { AgentChatPanel } from "./AgentChatPanel";

type AvailableSkill = { id: string; name: string; description: string };
type InitialAgentSkill = { skillId: string; name: string; description: string; positionX: number; positionY: number };

export function AgentWorkspace({
  agentId,
  initialName,
  initialSystemPrompt,
  availableSkills,
  initialAgentSkills,
}: {
  agentId: string;
  initialName: string;
  initialSystemPrompt: string;
  availableSkills: AvailableSkill[];
  initialAgentSkills: InitialAgentSkill[];
}) {
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);

  return (
    <>
      <AgentCanvas
        agentId={agentId}
        initialName={initialName}
        initialSystemPrompt={initialSystemPrompt}
        availableSkills={availableSkills}
        initialAgentSkills={initialAgentSkills}
        activeSkillId={activeSkillId}
      />
      <AgentChatPanel agentId={agentId} onToolStart={setActiveSkillId} onToolEnd={() => setActiveSkillId(null)} />
    </>
  );
}
