/**
 * SKILL ASSESSMENT & LEARNING PLAN AGENT - BACKEND
 * Express.js + Groq API
 * 
 * Features:
 * - Extract skills from Job Description
 * - Conversational skill assessment
 * - Skill gap analysis
 * - Personalized learning plan generation
 */

const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store assessment state (in production, use database)
const assessmentSessions = {};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Call Groq API with error handling
 */
async function callGroq(messages, maxTokens = 500) {
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    });
    
    return {
      success: true,
      content: response.choices[0].message.content,
      model: response.model,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      }
    };
  } catch (error) {
    console.error('Groq API Error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Extract skills from Job Description
 */
async function extractSkillsFromJD(jdText) {
  const prompt = `You are a skill extraction expert. Analyze this Job Description and extract ONLY the required and nice-to-have skills.

Job Description:
${jdText}

Return a JSON object with this exact structure:
{
  "required_skills": [
    {"skill": "Python", "importance": 0.9, "category": "programming_language"},
    {"skill": "Django", "importance": 0.85, "category": "framework"},
    ...
  ],
  "nice_to_have": [
    {"skill": "Docker", "importance": 0.6, "category": "devops"},
    ...
  ]
}

Be precise and only extract actual skills mentioned. Return ONLY valid JSON, no extra text.`;

  const response = await callGroq(
    [{ role: 'user', content: prompt }],
    500
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

/**
 * Extract skills from Resume
 */
async function extractSkillsFromResume(resumeText) {
  const prompt = `You are a resume analyzer. Extract all skills mentioned in this resume.

Resume:
${resumeText}

Return a JSON object with this structure:
{
  "skills": [
    {"skill": "Python", "proficiency": "intermediate", "years": 2},
    {"skill": "Java", "proficiency": "beginner", "years": 0.5},
    ...
  ],
  "experience_summary": "Brief summary of relevant experience"
}

Return ONLY valid JSON, no extra text.`;

  const response = await callGroq(
    [{ role: 'user', content: prompt }],
    400
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

/**
 * Generate assessment question for a skill
 */
async function generateAssessmentQuestion(skill, candidateLevel = 'unknown') {
  const prompt = `You are a technical interviewer assessing ${skill} proficiency.

The candidate claims to have ${candidateLevel || 'some'} experience with ${skill}.

Generate ONE specific, practical question to assess their actual proficiency level. 
The question should:
- Be clear and concrete
- Allow them to demonstrate depth of knowledge
- Be answerable in 1-2 sentences

Return ONLY the question, nothing else.`;

  const response = await callGroq(
    [{ role: 'user', content: prompt }],
    100
  );

  return response.success ? response.content : null;
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

/**
 * Generate personalized learning plan
 */
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
4. Provides specific resources (Udemy, YouTube, docs, books)

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
    },
    ...
  ],
  "total_timeline_weeks": 12,
  "can_parallelize": true,
  "estimated_study_hours": 150,
  "summary": "Focus on Django and PostgreSQL first..."
}

Return ONLY valid JSON.`;

  const response = await callGroq(
    [{ role: 'user', content: prompt }],
    1000
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

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * POST /api/assess
 * Start a new assessment session
 */
app.post('/api/assess', async (req, res) => {
  try {
    const { jd, resume } = req.body;

    if (!jd || !resume) {
      return res.status(400).json({ error: 'JD and resume are required' });
    }

    console.log('Starting assessment...');

    // Extract skills from both JD and resume
    const [jdSkills, resumeSkills] = await Promise.all([
      extractSkillsFromJD(jd),
      extractSkillsFromResume(resume),
    ]);

    if (!jdSkills || !resumeSkills) {
      return res.status(500).json({ 
        error: 'Failed to extract skills. Please try again.' 
      });
    }

    // Create session
    const sessionId = Date.now().toString();
    assessmentSessions[sessionId] = {
      jdSkills,
      resumeSkills,
      assessedSkills: {},
      currentSkillIndex: 0,
      createdAt: new Date(),
    };

    console.log(`Session ${sessionId} created`);

    res.json({
      sessionId,
      jdSkills,
      resumeSkills,
      requiredSkillsCount: jdSkills.required_skills?.length || 0,
      message: 'Assessment initialized. Ready to assess skills.',
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/assess/:sessionId/next-question
 * Get next assessment question for a skill
 */
app.get('/api/assess/:sessionId/next-question', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = assessmentSessions[sessionId];

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const requiredSkills = session.jdSkills.required_skills;
    
    // Find next unassessed skill
    let nextSkill = null;
    for (const skill of requiredSkills) {
      if (!session.assessedSkills[skill.skill]) {
        nextSkill = skill;
        break;
      }
    }

    if (!nextSkill) {
      return res.json({
        completed: true,
        message: 'All critical skills assessed!',
      });
    }

    // Get candidate's claim about this skill
    const candidateClaim = session.resumeSkills.skills?.find(
      s => s.skill.toLowerCase() === nextSkill.skill.toLowerCase()
    );

    const question = await generateAssessmentQuestion(
      nextSkill.skill,
      candidateClaim?.proficiency || 'unknown'
    );

    if (!question) {
      return res.status(500).json({ error: 'Failed to generate question' });
    }

    res.json({
      skillIndex: requiredSkills.indexOf(nextSkill),
      totalSkills: requiredSkills.length,
      skill: nextSkill.skill,
      question,
      importance: nextSkill.importance,
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/assess/:sessionId/answer
 * Submit answer and get score for a skill
 */
app.post('/api/assess/:sessionId/answer', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { skill, question, answer } = req.body;

    if (!skill || !question || !answer) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const session = assessmentSessions[sessionId];
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Score the answer
    const assessment = await scoreSkillAnswer(skill, question, answer);

    if (!assessment) {
      return res.status(500).json({ error: 'Failed to score answer' });
    }

    // Store in session
    session.assessedSkills[skill] = {
      score: assessment.score,
      level: assessment.level,
      reasoning: assessment.reasoning,
      gaps: assessment.gaps,
      strengths: assessment.strengths,
      question,
      answer,
    };

    console.log(`${skill}: ${assessment.score}/100 (${assessment.level})`);

    res.json({
      skill,
      score: assessment.score,
      level: assessment.level,
      reasoning: assessment.reasoning,
      gaps: assessment.gaps,
      strengths: assessment.strengths,
      assessedCount: Object.keys(session.assessedSkills).length,
      totalRequired: session.jdSkills.required_skills?.length || 0,
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/assess/:sessionId/learning-plan
 * Generate personalized learning plan
 */
app.get('/api/assess/:sessionId/learning-plan', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = assessmentSessions[sessionId];

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (Object.keys(session.assessedSkills).length === 0) {
      return res.status(400).json({ 
        error: 'No skills assessed yet. Complete assessment first.' 
      });
    }

    // Analyze gaps
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

    // Generate learning plan
    const learningPlan = await generateLearningPlan(
      session.jdSkills,
      session.assessedSkills,
      gapAnalysis
    );

    if (!learningPlan) {
      return res.status(500).json({ error: 'Failed to generate learning plan' });
    }

    session.learningPlan = learningPlan;

    res.json({
      sessionId,
      assessedSkills: session.assessedSkills,
      learningPlan,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/assess/:sessionId/summary
 * Get full assessment summary
 */
app.get('/api/assess/:sessionId/summary', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = assessmentSessions[sessionId];

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      sessionId,
      jdSkills: session.jdSkills,
      resumeSkills: session.resumeSkills,
      assessedSkills: session.assessedSkills,
      learningPlan: session.learningPlan || null,
      progress: {
        assessed: Object.keys(session.assessedSkills).length,
        total: session.jdSkills.required_skills?.length || 0,
      },
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Skill Assessment Backend is running',
    timestamp: new Date(),
  });
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
  console.log(`  POST   /api/assess                      - Start assessment`);
  console.log(`  GET    /api/assess/:sessionId/next-question`);
  console.log(`  POST   /api/assess/:sessionId/answer    - Submit answer`);
  console.log(`  GET    /api/assess/:sessionId/learning-plan`);
  console.log(`  GET    /api/assess/:sessionId/summary`);
  console.log(`  GET    /api/health                      - Health check`);
  console.log(`${'='.repeat(70)}\n`);
});

module.exports = app;