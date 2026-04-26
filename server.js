/**
 * SKILL ASSESSMENT & LEARNING PLAN AGENT - BACKEND
 * Express.js + Groq API
 *
 * Features:
 * - Extract skills from Job Description
 * - Conversational skill assessment
 * - TRUE AGENT LOOP via Groq Tool Use / Function Calling ← NEW
 * - LLM decides which tools to call and when            ← NEW
 * - Conversation memory per skill
 * - Skill gap analysis
 * - Personalized learning plan generation
 */

const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
const groqApiKey = process.env.GROQ_API_KEY;
if (!groqApiKey) throw new Error('Missing required environment variable: GROQ_API_KEY');
const groq = new Groq({ apiKey: groqApiKey });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const assessmentSessions = {};

// ============================================================================
// TOOL DEFINITIONS — what the LLM can see and choose to call
// ============================================================================

const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'evaluate_answer',
      description: 'Evaluate the candidate\'s answer to a skill question. Returns a score 0-100, proficiency level, strengths, and gaps. Call this first after receiving any answer.',
      parameters: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: 'The skill being assessed e.g. "React", "Python"' },
          question: { type: 'string', description: 'The question that was asked' },
          answer: { type: 'string', description: "The candidate's answer" },
          job_requirement_level: {
            type: 'string',
            enum: ['beginner', 'intermediate', 'advanced', 'not specified'],
            description: 'The proficiency level required by the job',
          },
        },
        required: ['skill', 'question', 'answer', 'job_requirement_level'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_followup',
      description: 'Generate a targeted follow-up question when the candidate\'s answer was weak (score < 60). Only call this if score < 60 AND attempts < 2.',
      parameters: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: 'The skill being assessed' },
          gaps: { type: 'array', items: { type: 'string' }, description: 'Specific knowledge gaps identified' },
          job_requirement_level: { type: 'string', description: 'The proficiency level required by the job' },
          previous_answer: { type: 'string', description: "The candidate's previous weak answer" },
        },
        required: ['skill', 'gaps', 'job_requirement_level', 'previous_answer'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finalize_skill',
      description: 'Finalize the assessment for a skill. Call this when score >= 60 OR attempts >= 2. Do NOT call if asking a follow-up.',
      parameters: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: 'The skill being finalized' },
          final_score: { type: 'number', description: 'Final score 0-100' },
          final_level: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
          reasoning: { type: 'string', description: 'Brief explanation of the final score' },
          strengths: { type: 'array', items: { type: 'string' } },
          gaps: { type: 'array', items: { type: 'string' } },
        },
        required: ['skill', 'final_score', 'final_level', 'reasoning', 'strengths', 'gaps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_learning_resources',
      description: 'Fetch curated learning resources for a skill. Call this when finalizing a skill that has gaps.',
      parameters: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: 'The skill to find resources for' },
          current_level: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
          target_level: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
        },
        required: ['skill', 'current_level', 'target_level'],
      },
    },
  },
];

// ============================================================================
// TOOL IMPLEMENTATIONS — actual functions that run when LLM calls a tool
// ============================================================================

async function tool_evaluate_answer({ skill, question, answer, job_requirement_level }) {
  console.log(`  [Tool] evaluate_answer → ${skill}`);
  const prompt = `You are evaluating a candidate's ${skill} proficiency for a job that requires ${job_requirement_level} level.

Question: ${question}
Answer: ${answer}

Return ONLY valid JSON:
{
  "score": 65,
  "level": "intermediate",
  "reasoning": "Shows practical knowledge but lacks depth in error handling",
  "strengths": ["practical application"],
  "gaps": ["error handling", "performance optimization"]
}`;

  const response = await callGroq([{ role: 'user', content: prompt }], 300);
  if (!response.success) return { score: 50, level: 'intermediate', reasoning: 'Evaluation failed', strengths: [], gaps: [] };
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    return { score: 50, level: 'intermediate', reasoning: 'Could not parse evaluation', strengths: [], gaps: [] };
  }
}

async function tool_generate_followup({ skill, gaps, job_requirement_level, previous_answer }) {
  console.log(`  [Tool] generate_followup → ${skill}, gaps: ${gaps.join(', ')}`);
  const prompt = `You are a technical interviewer assessing ${skill} at ${job_requirement_level} level.

The candidate gave a weak answer: "${previous_answer}"
Their gaps are: ${gaps.join(', ')}

Generate ONE specific follow-up question targeting their gaps. Return ONLY the question text.`;

  const response = await callGroq([{ role: 'user', content: prompt }], 150);
  return {
    question: response.success ? response.content.trim() : `Can you elaborate more on ${gaps[0]} in ${skill}?`,
  };
}

async function tool_finalize_skill({ skill, final_score, final_level, reasoning, strengths, gaps }) {
  console.log(`  [Tool] finalize_skill → ${skill}: ${final_score}/100`);
  return { skill, final_score, final_level, reasoning, strengths, gaps, finalized: true };
}

async function tool_fetch_learning_resources({ skill, current_level, target_level }) {
  console.log(`  [Tool] fetch_learning_resources → ${skill} (${current_level} → ${target_level})`);
  const prompt = `Suggest the best resources to learn ${skill} from ${current_level} to ${target_level} level.

Return ONLY valid JSON:
{
  "resources": [
    {
      "title": "Resource name",
      "type": "course|documentation|book|video|practice",
      "url": "https://example.com/resource",
      "hours": 10,
      "description": "Why this is good"
    }
  ],
  "weeks_needed": 4,
  "adjacent_skills": ["skill1", "skill2"]
}

IMPORTANT: Always provide at least 3 resources. Use REAL resources: GeeksforGeeks, official docs, freeCodeCamp, MDN, specific courses.
Each resource title MUST have a real name, type MUST be one of the enum values, url MUST be a valid URL, hours MUST be a positive number.`;

  const response = await callGroq([{ role: 'user', content: prompt }], 600);
  if (!response.success) {
    console.log('  [Tool] Resource fetch failed, returning defaults');
    return { resources: [], weeks_needed: 4, adjacent_skills: [] };
  }
  
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate and clean up resources
    if (parsed.resources && Array.isArray(parsed.resources)) {
      parsed.resources = parsed.resources.map(r => ({
        title: r.title || 'Unnamed Resource',
        type: r.type || 'course',
        url: r.url || 'https://example.com',
        hours: Number(r.hours) || 5,
        description: r.description || 'Learning resource'
      }));
    }
    
    return parsed;
  } catch (e) {
    console.log('  [Tool] Failed to parse resources:', e.message);
    return { resources: [], weeks_needed: 4, adjacent_skills: [] };
  }
}

async function executeTool(toolName, toolArgs) {
  switch (toolName) {
    case 'evaluate_answer':          return await tool_evaluate_answer(toolArgs);
    case 'generate_followup':        return await tool_generate_followup(toolArgs);
    case 'finalize_skill':           return await tool_finalize_skill(toolArgs);
    case 'fetch_learning_resources': return await tool_fetch_learning_resources(toolArgs);
    default: return { error: `Unknown tool: ${toolName}` };
  }
}

// ============================================================================
// ★ THE CORE AGENT LOOP ★
// LLM decides what tools to call. We execute and feed results back.
// ============================================================================

async function runAgentLoop(skill, conversationHistory, jobRequirement, attemptNumber) {
  console.log(`\n[Agent] Starting loop → ${skill} (attempt ${attemptNumber})`);

  const convoText = conversationHistory
    .map(m => `${m.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${m.content}`)
    .join('\n\n');

  const messages = [
    {
      role: 'system',
      content: `You are an intelligent skill assessment agent evaluating a candidate's ${skill} proficiency.
Job requires: ${jobRequirement || 'intermediate'} level.
This is attempt number ${attemptNumber} (maximum 2 attempts per skill).

Your job:
1. ALWAYS call evaluate_answer first to score the latest candidate response
2. If score < 60 AND attempt < 2: call generate_followup to probe deeper, then STOP
3. If score >= 60 OR attempt >= 2: call finalize_skill to save the result
4. If finalizing and candidate has gaps: also call fetch_learning_resources
Think step by step and use tools in the right order.`,
    },
    {
      role: 'user',
      content: `Full conversation for ${skill} assessment:\n\n${convoText}\n\nEvaluate and decide next steps.`,
    },
  ];

  const agentResult = {
    status: null,
    evaluation: null,
    followup: null,
    finalized: null,
    resources: null,
  };

  let iteration = 0;
  const MAX_ITERATIONS = 8;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`[Agent] Iteration ${iteration}`);

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      tools: AGENT_TOOLS,
      tool_choice: 'auto',
      max_tokens: 1000,
      temperature: 0.3,
    });

    const message = response.choices[0].message;
    messages.push(message);

    // No tool calls = LLM is done
    if (!message.tool_calls || message.tool_calls.length === 0) {
      console.log('[Agent] Done — no more tool calls');
      break;
    }

    // Execute each tool the LLM called
    for (const toolCall of message.tool_calls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      console.log(`[Agent] LLM called: ${toolName}`);
      const toolResult = await executeTool(toolName, toolArgs);

      if (toolName === 'evaluate_answer')          agentResult.evaluation = toolResult;
      if (toolName === 'generate_followup')        { agentResult.followup = toolResult; agentResult.status = 'followup'; }
      if (toolName === 'finalize_skill')           { agentResult.finalized = toolResult; agentResult.status = 'completed'; }
      if (toolName === 'fetch_learning_resources') agentResult.resources = toolResult;

      // Feed result back to LLM
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  console.log(`[Agent] Complete → status: ${agentResult.status}`);
  return agentResult;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function callGroq(messages, maxTokens = 500) {
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    });
    return { success: true, content: response.choices[0].message.content };
  } catch (error) {
    console.error('Groq API Error:', error);
    return { success: false, error: error.message };
  }
}

async function extractSkillsFromJD(jdText) {
  const prompt = `You are a skill extraction expert. Analyze this Job Description and extract ONLY the required and nice-to-have skills.

Important: If the JD specifies an expected proficiency level for a skill, capture it using beginner/intermediate/advanced. If no level is present, set level to null.

Job Description:
${jdText}

Return a JSON object with this exact structure:
{
  "required_skills": [
    {"skill": "Python", "importance": 0.9, "category": "programming_language", "level": "intermediate"},
    {"skill": "Django", "importance": 0.85, "category": "framework", "level": null}
  ],
  "nice_to_have": [
    {"skill": "Docker", "importance": 0.6, "category": "devops", "level": null}
  ]
}

Be precise and only extract actual skills mentioned. Return ONLY valid JSON, no extra text.`;

  const response = await callGroq([{ role: 'user', content: prompt }], 500);
  if (!response.success) return null;
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch (e) { return null; }
}

async function extractSkillsFromResume(resumeText) {
  const prompt = `You are a resume analyzer. Extract all skills mentioned in this resume.

IMPORTANT: Infer proficiency from context:
- Experience section with years → intermediate/advanced
- Skills section only → beginner/intermediate  
- <1yr=beginner, 1-3yrs=intermediate, >3yrs=advanced

Resume:
${resumeText}

Return JSON:
{
  "skills": [
    {"skill": "Python", "proficiency": "intermediate", "years": 2, "inferred": true}
  ],
  "experience_summary": "Brief summary"
}

Return ONLY valid JSON.`;

  const response = await callGroq([{ role: 'user', content: prompt }], 400);
  if (!response.success) return null;
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch (e) { return null; }
}

async function generateFirstQuestion(skill, candidateLevel, jobRequirement) {
  const response = await callGroq([
    { role: 'system', content: `You are a conversational technical interviewer assessing ${skill} proficiency. Ask one clear, focused question at a time.` },
    { role: 'user', content: `Candidate level: ${candidateLevel || 'unknown'}. Job requires: ${jobRequirement || 'not specified'}. Ask your FIRST question to assess their ${skill} knowledge. Return ONLY the question.` },
  ], 150);
  return response.success ? response.content.trim() : null;
}

function analyzeSkillGap(skill, candidateLevel, requiredLevel) {
  const levels = { beginner: 1, intermediate: 2, advanced: 3 };
  const candidateScore = levels[candidateLevel?.toLowerCase()] || 0;
  const requiredScore = levels[requiredLevel?.toLowerCase()] || 0;
  return {
    skill,
    candidateClaimed: candidateLevel || 'unknown',
    jobRequires: requiredLevel || 'not specified',
    gap: requiredScore - candidateScore,
    meetsRequirement: candidateScore >= requiredScore,
  };
}

async function generateLearningPlan(jdSkills, assessedSkills, gapAnalysis) {
  const prompt = `You are an expert learning path designer.

Required Skills (from JD): ${JSON.stringify(jdSkills, null, 2)}
Candidate's Assessed Skills: ${JSON.stringify(assessedSkills, null, 2)}
Skill Gaps: ${JSON.stringify(gapAnalysis, null, 2)}

Create a personalized learning plan. Return JSON:
{
  "learning_path": [
    {
      "skill": "Django",
      "priority": "critical|high|medium",
      "current_level": 40,
      "target_level": 85,
      "weeks_needed": 6,
      "reason": "Essential for role, significant gap",
      "resources": [
        {"title": "Resource name", "type": "course|book|video|documentation", "url": "https://...", "hours": 30, "description": "Good intro"}
      ],
      "adjacent_skills": ["REST APIs", "PostgreSQL"]
    }
  ],
  "total_timeline_weeks": 12,
  "can_parallelize": true,
  "estimated_study_hours": 150,
  "summary": "Focus on Django first..."
}

IMPORTANT for resources section:
- Each resource MUST have: title (string), type (course|book|video|documentation), url (valid URL), hours (number), description (string)
- Provide 2-4 resources per skill
- Hours must be realistic (10-50 range for most courses)
- URL must start with https://
- Total estimated_study_hours should be the SUM of all resource hours across all skills

Return ONLY valid JSON, no markdown code blocks.`;

  const response = await callGroq([{ role: 'user', content: prompt }], 1200);
  if (!response.success) return null;
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate and normalize the learning path
    if (parsed.learning_path && Array.isArray(parsed.learning_path)) {
      let totalHours = 0;
      
      parsed.learning_path = parsed.learning_path.map(item => {
        // Ensure resources have all required fields
        if (item.resources && Array.isArray(item.resources)) {
          item.resources = item.resources.map(r => ({
            title: r.title || 'Resource',
            type: r.type || 'course',
            url: r.url || 'https://example.com',
            hours: Number(r.hours) || 10,
            description: r.description || ''
          }));
          
          // Add up resource hours for this skill
          item.resource_hours = item.resources.reduce((sum, r) => sum + r.hours, 0);
          totalHours += item.resource_hours;
        } else {
          item.resources = [];
          item.resource_hours = 0;
        }
        
        return item;
      });
      
      // Recalculate total if it seems wrong
      if (totalHours > 0 && parsed.estimated_study_hours) {
        const difference = Math.abs(parsed.estimated_study_hours - totalHours);
        if (difference > 50) {
          console.log(`[Learning Plan] Correcting estimated_study_hours from ${parsed.estimated_study_hours} to ${totalHours}`);
          parsed.estimated_study_hours = totalHours;
        }
      }
    }
    
    return parsed;
  } catch (e) {
    console.log('[Learning Plan] Parse error:', e.message);
    return null;
  }
}

// ============================================================================
// ★ AGENT SKILL PRIORITIZATION ★
// LLM decides which skill to assess next based on importance + candidate gap
// ============================================================================

async function agentPickNextSkill(remainingSkills, assessedSkills, candidateSkills) {
  console.log(`\n[Agent] Picking next skill from: ${remainingSkills.map(s => s.skill).join(', ')}`);

  // If only one left, no need to ask LLM
  if (remainingSkills.length === 1) {
    console.log(`[Agent] Only one skill left: ${remainingSkills[0].skill}`);
    return remainingSkills[0];
  }

  const remainingContext = remainingSkills.map(s => {
    const candidateClaim = candidateSkills.find(
      c => c.skill.toLowerCase() === s.skill.toLowerCase()
    );
    return {
      skill: s.skill,
      importance: s.importance,
      jobRequires: s.level || 'not specified',
      candidateClaims: candidateClaim?.proficiency || 'unknown',
      claimedVsRequired: candidateClaim
        ? `candidate says ${candidateClaim.proficiency}, job needs ${s.level || 'not specified'}`
        : 'no info on candidate level',
    };
  });

  const alreadyAssessed = Object.entries(assessedSkills).map(([skill, data]) => ({
    skill,
    score: data.score,
    level: data.level,
  }));

  const prompt = `You are a skill assessment agent deciding which skill to assess next.

Already assessed:
${JSON.stringify(alreadyAssessed, null, 2)}

Remaining skills to assess:
${JSON.stringify(remainingContext, null, 2)}

Prioritization rules:
1. Higher importance score -> assess first (most critical to the job)
2. If importance is similar, assess skills where candidate level is BELOW job requirement first
3. Skills where candidate claims advanced but job only needs beginner -> lower priority

Return ONLY valid JSON:
{
  "chosen_skill": "Python",
  "reason": "Highest importance (0.9) and candidate only claims beginner while job needs intermediate"
}`;

  const response = await callGroq([{ role: 'user', content: prompt }], 200);

  if (!response.success) {
    console.log('[Agent] Prioritization failed, falling back to importance sort');
    return remainingSkills.sort((a, b) => b.importance - a.importance)[0];
  }

  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    const decision = JSON.parse(jsonMatch[0]);
    console.log(`[Agent] Chose: ${decision.chosen_skill} — ${decision.reason}`);
    const chosen = remainingSkills.find(
      s => s.skill.toLowerCase() === decision.chosen_skill.toLowerCase()
    );
    return chosen || remainingSkills.sort((a, b) => b.importance - a.importance)[0];
  } catch (e) {
    console.log('[Agent] Could not parse prioritization, falling back to importance sort');
    return remainingSkills.sort((a, b) => b.importance - a.importance)[0];
  }
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

app.post('/api/assess', async (req, res) => {
  try {
    const { jd, resume } = req.body;
    if (!jd || !resume) return res.status(400).json({ error: 'JD and resume are required' });

    const [jdSkills, resumeSkills] = await Promise.all([
      extractSkillsFromJD(jd),
      extractSkillsFromResume(resume),
    ]);

    if (!jdSkills || !resumeSkills) return res.status(500).json({ error: 'Failed to extract skills.' });

    const sessionId = Date.now().toString();
    assessmentSessions[sessionId] = {
      jdSkills,
      resumeSkills,
      assessedSkills: {},
      skillConversations: {},
      skillResources: {},
      createdAt: new Date(),
    };

    res.json({ sessionId, jdSkills, resumeSkills, requiredSkillsCount: jdSkills.required_skills?.length || 0, message: 'Assessment initialized.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/assess/:sessionId/next-question', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = assessmentSessions[sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const requiredSkills = session.jdSkills.required_skills;

    // Find remaining (unassessed) skills
    const remainingSkills = requiredSkills.filter(s => !session.assessedSkills[s.skill]);
    if (remainingSkills.length === 0) return res.json({ completed: true, message: 'All skills assessed!' });

    // ★ AGENT DECIDES which skill to assess next ★
    const nextSkill = await agentPickNextSkill(
      remainingSkills,
      session.assessedSkills,
      session.resumeSkills.skills || []
    );

    if (!nextSkill) return res.json({ completed: true, message: 'All skills assessed!' });

    const candidateClaim = session.resumeSkills.skills?.find(
      s => s.skill.toLowerCase() === nextSkill.skill.toLowerCase()
    );
    const jobRequirementLevel = nextSkill.level || 'not specified';
    const question = await generateFirstQuestion(nextSkill.skill, candidateClaim?.proficiency || 'unknown', jobRequirementLevel);
    if (!question) return res.status(500).json({ error: 'Failed to generate question' });

    session.skillConversations[nextSkill.skill] = {
      history: [{ role: 'interviewer', content: question }],
      attemptNumber: 1,
      jobRequirement: jobRequirementLevel,
      candidateClaimed: candidateClaim?.proficiency || 'unknown',
    };

    const assessedCount = Object.keys(session.assessedSkills).length;

    res.json({
      skillIndex: assessedCount,
      totalSkills: requiredSkills.length,
      skill: nextSkill.skill,
      question,
      importance: nextSkill.importance,
      candidateClaimed: candidateClaim?.proficiency || 'unknown',
      jobRequires: jobRequirementLevel,
      attemptNumber: 1,
      isFollowUp: false,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/assess/:sessionId/answer
 * ★ REAL GROQ TOOL USE AGENT LOOP ★
 */
app.post('/api/assess/:sessionId/answer', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { skill, answer } = req.body;
    if (!skill || !answer) return res.status(400).json({ error: 'skill and answer are required' });

    const session = assessmentSessions[sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const convo = session.skillConversations[skill];
    if (!convo) return res.status(400).json({ error: 'No active question for this skill. Call /next-question first.' });

    // Add answer to memory
    convo.history.push({ role: 'candidate', content: answer });

    // ★ LLM decides what to do via tool use
    const agentResult = await runAgentLoop(skill, convo.history, convo.jobRequirement, convo.attemptNumber);

    if (!agentResult.status) return res.status(500).json({ error: 'Agent failed to reach a decision' });

    // CASE A: follow-up
    if (agentResult.status === 'followup' && agentResult.followup?.question) {
      convo.history.push({ role: 'interviewer', content: agentResult.followup.question });
      convo.attemptNumber += 1;

      return res.json({
        status: 'followup',
        skill,
        score: agentResult.evaluation?.score,
        reasoning: agentResult.evaluation?.reasoning,
        followup_question: agentResult.followup.question,
        attemptNumber: convo.attemptNumber,
      });
    }

    // CASE B: completed
    if (agentResult.status === 'completed' && agentResult.finalized) {
      const { final_score, final_level, reasoning, strengths, gaps } = agentResult.finalized;

      session.assessedSkills[skill] = {
        score: final_score,
        level: final_level,
        reasoning,
        gaps,
        strengths,
        totalAttempts: convo.attemptNumber,
        conversationHistory: convo.history,
        resources: agentResult.resources || null,
      };

      if (agentResult.resources) session.skillResources[skill] = agentResult.resources;

      console.log(`✓ ${skill}: ${final_score}/100 (${final_level}) after ${convo.attemptNumber} attempt(s)`);

      return res.json({
        status: 'completed',
        skill,
        score: final_score,
        level: final_level,
        reasoning,
        gaps,
        strengths,
        totalAttempts: convo.attemptNumber,
        assessedCount: Object.keys(session.assessedSkills).length,
        totalRequired: session.jdSkills.required_skills?.length || 0,
      });
    }

    return res.status(500).json({ error: 'Agent returned unexpected state' });
  } catch (error) {
    console.error('Answer endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/assess/:sessionId/learning-plan', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = assessmentSessions[sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (Object.keys(session.assessedSkills).length === 0) return res.status(400).json({ error: 'No skills assessed yet.' });

    const gapAnalysis = {};
    for (const skill of session.jdSkills.required_skills) {
      const assessed = session.assessedSkills[skill.skill];
      gapAnalysis[skill.skill] = {
        required: true,
        importance: skill.importance,
        currentScore: assessed?.score || 0,
        targetScore: 85,
        gap: (assessed?.score || 0) - 85,
        agentResources: session.skillResources[skill.skill] || null,
      };
    }

    const learningPlan = await generateLearningPlan(session.jdSkills, session.assessedSkills, gapAnalysis);
    if (!learningPlan) return res.status(500).json({ error: 'Failed to generate learning plan' });

    session.learningPlan = learningPlan;
    res.json({ sessionId, assessedSkills: session.assessedSkills, learningPlan, timestamp: new Date() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/assess/:sessionId/summary', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = assessmentSessions[sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const gapAnalysis = session.jdSkills.required_skills.map((skill) => {
      const candidateClaim = session.resumeSkills.skills?.find(s => s.skill.toLowerCase() === skill.skill.toLowerCase());
      return analyzeSkillGap(skill.skill, candidateClaim?.proficiency || 'unknown', skill.level || 'not specified');
    });

    res.json({
      sessionId,
      jdSkills: session.jdSkills,
      resumeSkills: session.resumeSkills,
      assessedSkills: session.assessedSkills,
      learningPlan: session.learningPlan || null,
      gapAnalysis,
      progress: {
        assessed: Object.keys(session.assessedSkills).length,
        total: session.jdSkills.required_skills?.length || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Skill Assessment Agent running', timestamp: new Date() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🤖 Skill Assessment AGENT running on http://localhost:${PORT}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`Agent Tools: evaluate_answer | generate_followup | finalize_skill | fetch_learning_resources`);
  console.log(`${'='.repeat(70)}\n`);
});

module.exports = app;