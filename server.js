/**
 * SKILL ASSESSMENT & LEARNING PLAN AGENT - BACKEND
 * Express.js + Groq API
 *
 * Features:
 * - Extract skills from Job Description
 * - Conversational skill assessment WITH FEEDBACK LOOP ← NEW
 * - Follow-up questions based on answer quality       ← NEW
 * - Conversation history per skill                    ← NEW
 * - Skill gap analysis
 * - Personalized learning plan generation
 */

const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
const groqApiKey = process.env.GROQ_API_KEY;
if (!groqApiKey) {
  throw new Error('Missing required environment variable: GROQ_API_KEY');
}
const groq = new Groq({ apiKey: groqApiKey });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const assessmentSessions = {};

// ============================================================================
// HELPER FUNCTIONS (unchanged from your original)
// ============================================================================

async function callGroq(messages, maxTokens = 500) {
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    });
    return {
      success: true,
      content: response.choices[0].message.content,
    };
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
  } catch (e) {
    return null;
  }
}

async function extractSkillsFromResume(resumeText) {
  const prompt = `You are a resume analyzer. Extract all skills mentioned in this resume.

IMPORTANT: If proficiency level is NOT explicitly stated, INFER it from context:
- If skill mentioned in "EXPERIENCE" section with years → likely intermediate/advanced
- If skill mentioned in "SKILLS" section only → likely beginner/intermediate
- If mentioned with years of experience → estimate: <1yr=beginner, 1-3yrs=intermediate, >3yrs=advanced
- If no years but in recent projects → intermediate
- If mentioned passively → beginner

Resume:
${resumeText}

Return JSON:
{
  "skills": [
    {"skill": "Python", "proficiency": "intermediate", "years": 2, "inferred": true}
  ],
  "experience_summary": "Brief summary of relevant experience"
}

Return ONLY valid JSON, no extra text.`;

  const response = await callGroq([{ role: 'user', content: prompt }], 400);
  if (!response.success) return null;
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    return null;
  }
}

// ============================================================================
// NEW AGENT FUNCTIONS — THE FEEDBACK LOOP
// ============================================================================

/**
 * Generate first question for a skill using full conversation context
 */
async function generateFirstQuestion(skill, candidateLevel, jobRequirement) {
  const systemPrompt = `You are a conversational technical interviewer assessing ${skill} proficiency.
Your goal is to determine the candidate's TRUE proficiency through natural conversation.
Ask one clear, focused question at a time. Be professional but conversational.`;

  const userPrompt = `Candidate's claimed level: ${candidateLevel || 'unknown'}
Job requires: ${jobRequirement || 'not specified'} level

Ask your FIRST question to assess their ${skill} knowledge at the ${jobRequirement || 'appropriate'} level.
Return ONLY the question, nothing else.`;

  const response = await callGroq(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    150
  );
  return response.success ? response.content.trim() : null;
}

/**
 * ★ THE CORE AGENT FUNCTION ★
 * 
 * Given the full conversation history for a skill, decide:
 * 1. Score the latest answer (0-100)
 * 2. Should we ask a follow-up? (if score < 60 and attempts < 2)
 * 3. If yes, generate a targeted follow-up question
 * 4. If no, finalize the score
 */
async function evaluateAndDecide(skill, conversationHistory, jobRequirement, attemptNumber) {
  const systemPrompt = `You are a technical interviewer assessing ${skill} proficiency.
You have been having a conversation with a candidate.
The job requires: ${jobRequirement || 'intermediate'} level.

Your job:
1. Evaluate their latest answer carefully
2. Decide if you need ONE follow-up question to better assess them
3. Return your decision as JSON`;

  // Build a readable conversation summary for the LLM
  const convoText = conversationHistory
    .map(m => `${m.role === 'interviewer' ? 'You asked' : 'Candidate answered'}: ${m.content}`)
    .join('\n\n');

  const userPrompt = `Conversation so far:
${convoText}

Based on this conversation, evaluate the candidate's ${skill} knowledge.

Return ONLY this JSON:
{
  "score": 65,
  "level": "intermediate",
  "reasoning": "Shows practical knowledge but lacks depth in error handling",
  "strengths": ["can explain basic concepts"],
  "gaps": ["error handling", "performance optimization"],
  "needs_followup": true,
  "followup_question": "Can you explain how you would handle errors in this scenario?",
  "followup_reason": "Answer was vague on error handling which is critical for this role"
}

Rules:
- "needs_followup": true ONLY if score < 60 AND this is attempt #${attemptNumber} (max 2 follow-ups total)
- If attempt >= 2, always set needs_followup to false
- followup_question should target a SPECIFIC gap you identified
- followup_question is null if needs_followup is false`;

  const response = await callGroq(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    400
  );

  if (!response.success) return null;
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    return null;
  }
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


/**
 * Score a skill based on answer
 */
async function scoreSkillAnswer(skill, question, answer) {
  const prompt = `You are evaluating someone's ${skill} proficiency.

Question: ${question}
Their Answer: ${answer}

Score their answer on a scale of 0-100 and provide reasoning.

Return a JSON object:
{
  "score": 65,
  "level": "intermediate",
  "reasoning": "Shows practical knowledge but lacks depth in X",
  "gaps": ["error handling", "optimization"],
  "strengths": ["practical application", "clear explanation"]
}

Return ONLY valid JSON.`;

  const response = await callGroq(
    [{ role: 'user', content: prompt }],
    300
  );

  if (!response.success) return null;

  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('JSON parse error:', e);
    return null;
  }
}

async function generateLearningPlan(jdSkills, assessedSkills, gapAnalysis) {
  const prompt = `You are an expert learning path designer.

Required Skills (from JD):
${JSON.stringify(jdSkills, null, 2)}

Candidate's Assessed Skills:
${JSON.stringify(assessedSkills, null, 2)}

Skill Gaps:
${JSON.stringify(gapAnalysis, null, 2)}

Create a personalized learning plan that:
1. Prioritizes critical gaps (skills with high importance and low current level)
2. Recommends adjacent/easier skills that complement critical skills
3. Suggests realistic timeline (in weeks)
4. Provides specific resources (Udemy, YouTube, docs, GeeksforGeeks, books)

Return JSON:
{
  "learning_path": [
    {
      "skill": "Django",
      "priority": "critical",
      "current_level": 40,
      "target_level": 85,
      "weeks_needed": 6,
      "reason": "Essential for role, significant gap",
      "resources": [
        {"title": "Django for Beginners", "type": "course", "url": "...", "hours": 30},
        {"title": "Official Django Docs", "type": "documentation", "url": "..."}
      ],
      "adjacent_skills": ["REST APIs", "PostgreSQL"]
    }
  ],
  "total_timeline_weeks": 12,
  "can_parallelize": true,
  "estimated_study_hours": 150,
  "summary": "Focus on Django and PostgreSQL first..."
}

Return ONLY valid JSON.`;

  const response = await callGroq([{ role: 'user', content: prompt }], 1000);
  if (!response.success) return null;
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    return null;
  }
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * POST /api/assess
 * Start a new assessment session (unchanged)
 */
app.post('/api/assess', async (req, res) => {
  try {
    const { jd, resume } = req.body;
    if (!jd || !resume) {
      return res.status(400).json({ error: 'JD and resume are required' });
    }

    const [jdSkills, resumeSkills] = await Promise.all([
      extractSkillsFromJD(jd),
      extractSkillsFromResume(resume),
    ]);

    if (!jdSkills || !resumeSkills) {
      return res.status(500).json({ error: 'Failed to extract skills. Please try again.' });
    }

    const sessionId = Date.now().toString();
    assessmentSessions[sessionId] = {
      jdSkills,
      resumeSkills,
      assessedSkills: {},       // final scores land here
      skillConversations: {},   // ← NEW: full chat history per skill
      createdAt: new Date(),
    };

    res.json({
      sessionId,
      jdSkills,
      resumeSkills,
      requiredSkillsCount: jdSkills.required_skills?.length || 0,
      message: 'Assessment initialized. Ready to assess skills.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/assess/:sessionId/next-question
 * Get the FIRST question for the next unassessed skill
 */
app.get('/api/assess/:sessionId/next-question', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = assessmentSessions[sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const requiredSkills = session.jdSkills.required_skills;

    // Find next skill that hasn't been FINALIZED yet
    let nextSkill = null;
    for (const skill of requiredSkills) {
      if (!session.assessedSkills[skill.skill]) {
        nextSkill = skill;
        break;
      }
    }

    if (!nextSkill) {
      return res.json({ completed: true, message: 'All skills assessed!' });
    }

    const candidateClaim = session.resumeSkills.skills?.find(
      s => s.skill.toLowerCase() === nextSkill.skill.toLowerCase()
    );
    const jobRequirementLevel = nextSkill.level || 'not specified';

    // Generate the first question
    const question = await generateFirstQuestion(
      nextSkill.skill,
      candidateClaim?.proficiency || 'unknown',
      jobRequirementLevel
    );

    if (!question) return res.status(500).json({ error: 'Failed to generate question' });

    // ← NEW: Initialize conversation history for this skill
    session.skillConversations[nextSkill.skill] = {
      history: [{ role: 'interviewer', content: question }],
      attemptNumber: 1,
      jobRequirement: jobRequirementLevel,
      candidateClaimed: candidateClaim?.proficiency || 'unknown',
    };

    res.json({
      skillIndex: requiredSkills.indexOf(nextSkill),
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
 * 
 * ★ UPGRADED: Now has feedback loop ★
 * 
 * Submit answer → agent evaluates → decides:
 *   A) Score < 60 and attempts < 2 → returns follow-up question
 *   B) Score >= 60 or attempts >= 2 → finalizes score, moves to next skill
 */
app.post('/api/assess/:sessionId/answer', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { skill, answer } = req.body;  // ← no longer need "question" from client

    if (!skill || !answer) {
      return res.status(400).json({ error: 'skill and answer are required' });
    }

    const session = assessmentSessions[sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const convo = session.skillConversations[skill];
    if (!convo) return res.status(400).json({ error: 'No active question for this skill. Call /next-question first.' });

    // Add candidate's answer to conversation history
    convo.history.push({ role: 'candidate', content: answer });

    // ★ Agent evaluates and decides next step
    const decision = await evaluateAndDecide(
      skill,
      convo.history,
      convo.jobRequirement,
      convo.attemptNumber
    );

    if (!decision) return res.status(500).json({ error: 'Failed to evaluate answer' });

    // CASE A: Score is weak → ask follow-up
    if (decision.needs_followup && decision.followup_question) {
      convo.history.push({ role: 'interviewer', content: decision.followup_question });
      convo.attemptNumber += 1;

      console.log(`${skill}: Score ${decision.score}/100 → asking follow-up (attempt ${convo.attemptNumber})`);

      return res.json({
        status: 'followup',            // ← frontend checks this
        skill,
        score: decision.score,         // interim score (can show or hide)
        reasoning: decision.reasoning,
        followup_question: decision.followup_question,
        followup_reason: decision.followup_reason,
        attemptNumber: convo.attemptNumber,
        message: `Follow-up question for ${skill}`,
      });
    }

    // CASE B: Good enough or max attempts reached → finalize
    session.assessedSkills[skill] = {
      score: decision.score,
      level: decision.level,
      reasoning: decision.reasoning,
      gaps: decision.gaps,
      strengths: decision.strengths,
      totalAttempts: convo.attemptNumber,
      conversationHistory: convo.history,  // stored for audit/display
    };

    console.log(`${skill}: FINAL ${decision.score}/100 (${decision.level}) after ${convo.attemptNumber} attempt(s)`);

    res.json({
      status: 'completed',             // ← frontend checks this
      skill,
      score: decision.score,
      level: decision.level,
      reasoning: decision.reasoning,
      gaps: decision.gaps,
      strengths: decision.strengths,
      totalAttempts: convo.attemptNumber,
      assessedCount: Object.keys(session.assessedSkills).length,
      totalRequired: session.jdSkills.required_skills?.length || 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/assess/:sessionId/learning-plan (unchanged logic, same as before)
 */
app.get('/api/assess/:sessionId/learning-plan', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = assessmentSessions[sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (Object.keys(session.assessedSkills).length === 0) {
      return res.status(400).json({ error: 'No skills assessed yet.' });
    }

    const gapAnalysis = {};
    for (const skill of session.jdSkills.required_skills) {
      const assessed = session.assessedSkills[skill.skill];
      gapAnalysis[skill.skill] = {
        required: true,
        importance: skill.importance,
        currentScore: assessed?.score || 0,
        targetScore: 85,
        gap: (assessed?.score || 0) - 85,
      };
    }

    const learningPlan = await generateLearningPlan(
      session.jdSkills,
      session.assessedSkills,
      gapAnalysis
    );

    if (!learningPlan) return res.status(500).json({ error: 'Failed to generate learning plan' });

    session.learningPlan = learningPlan;

    res.json({
      sessionId,
      assessedSkills: session.assessedSkills,
      learningPlan,
      timestamp: new Date(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/assess/:sessionId/summary
 */
app.get('/api/assess/:sessionId/summary', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = assessmentSessions[sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const gapAnalysis = session.jdSkills.required_skills.map((skill) => {
      const candidateClaim = session.resumeSkills.skills?.find(
        s => s.skill.toLowerCase() === skill.skill.toLowerCase()
      );
      return analyzeSkillGap(
        skill.skill,
        candidateClaim?.proficiency || 'unknown',
        skill.level || 'not specified'
      );
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
  res.json({ status: 'ok', message: 'Skill Assessment Backend is running', timestamp: new Date() });
});

// ============================================================================
// START SERVER
// ============================================================================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🚀 Skill Assessment Backend running on http://localhost:${PORT}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`API Endpoints:`);
  console.log(`  POST   /api/assess                       - Start assessment`);
  console.log(`  GET    /api/assess/:sessionId/next-question`);
  console.log(`  POST   /api/assess/:sessionId/answer     - Submit answer (with feedback loop)`);
  console.log(`  GET    /api/assess/:sessionId/learning-plan`);
  console.log(`  GET    /api/assess/:sessionId/summary`);
  console.log(`  GET    /api/health`);
  console.log(`${'='.repeat(70)}\n`);
});

module.exports = app;