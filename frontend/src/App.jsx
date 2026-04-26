import React, { useState, useRef } from 'react';
import axios from 'axios';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// API Service
const assessmentAPI = {
  startAssessment: (jd, resume) =>
    axios.post(`${API_BASE}/api/assess`, { jd, resume }),

  getNextQuestion: (sessionId) =>
    axios.get(`${API_BASE}/api/assess/${sessionId}/next-question`),

  submitAnswer: (sessionId, skill, answer) =>
    axios.post(`${API_BASE}/api/assess/${sessionId}/answer`, {
      skill,
      answer,
    }),

  getLearningPlan: (sessionId) =>
    axios.get(`${API_BASE}/api/assess/${sessionId}/learning-plan`),

  getSummary: (sessionId) =>
    axios.get(`${API_BASE}/api/assess/${sessionId}/summary`),
};

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

export default function App() {
  const [stage, setStage] = useState('upload'); // upload, assessing, results
  const [sessionId, setSessionId] = useState(null);
  const [jdText, setJdText] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleStartAssessment = async () => {
    if (!jdText.trim() || !resumeText.trim()) {
      setError('Please fill in both Job Description and Resume');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await assessmentAPI.startAssessment(jdText, resumeText);
      setSessionId(response.data.sessionId);
      setStage('assessing');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start assessment');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="logo">
            <div className="logo-icon">🎓</div>
            <h1>SkillAgent</h1>
          </div>
          <p className="tagline">AI-Powered Skill Assessment & Learning Plans</p>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {stage === 'upload' && (
          <UploadStage
            jdText={jdText}
            setJdText={setJdText}
            resumeText={resumeText}
            setResumeText={setResumeText}
            onStart={handleStartAssessment}
            loading={loading}
            error={error}
            setError={setError}
          />
        )}

        {stage === 'assessing' && sessionId && (
          <AssessmentStage
            sessionId={sessionId}
            onComplete={() => setStage('results')}
          />
        )}

        {stage === 'results' && sessionId && (
          <ResultsStage
            sessionId={sessionId}
            onRestart={() => {
              setStage('upload');
              setSessionId(null);
              setJdText('');
              setResumeText('');
            }}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>
          Built with ❤️ for skill assessment | Powered by Groq AI & Llama 3.3
        </p>
      </footer>
    </div>
  );
}

// ============================================================================
// UPLOAD STAGE COMPONENT
// ============================================================================

function UploadStage({
  jdText,
  setJdText,
  resumeText,
  setResumeText,
  onStart,
  loading,
  error,
  setError,
}) {
  const jdRef = useRef(null);
  const resumeRef = useRef(null);

  const handleFileUpload = (e, setText) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setText(event.target.result);
      setError(null);
    };
    reader.readAsText(file);
  };

  // Sample data for quick testing
  const useSampleData = () => {
    setJdText(`Senior Backend Engineer - Python, Django, PostgreSQL

Required Skills:
- 3+ years Python experience
- Django framework & Django ORM
- PostgreSQL database design
- REST API development
- Git version control

Nice to have:
- Docker & containerization
- Redis caching
- Unit testing & TDD
- AWS deployment

Responsibilities:
- Design and build scalable APIs
- Optimize database queries
- Mentor junior developers`);

    setResumeText(`John Doe
john@example.com | linkedin.com/in/johndoe

EXPERIENCE
Backend Developer - TechStartup (2 years)
- Built REST APIs using Flask
- Managed MySQL databases
- Deployed applications on AWS
- Collaborated with frontend team

Junior Developer - WebCo (1 year)
- Learned Python basics
- Wrote unit tests
- Used Git for version control

SKILLS
- Python (intermediate)
- Java (basic)
- MySQL (basic)
- HTML/CSS (basic)
- Git (intermediate)

EDUCATION
Bachelor's in Computer Science`);

    setError(null);
  };

  return (
    <div className="stage upload-stage">
      <div className="stage-container">
        <div className="stage-header">
          <h2>📋 Skill Assessment</h2>
          <p>Upload your Job Description and Resume to begin</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="input-grid">
          {/* JD Input */}
          <div className="input-box">
            <label className="input-label">
              <div className="label-header">
                <span>📄 Job Description</span>
                <span className="label-hint">Required</span>
              </div>
            </label>

            <textarea
              value={jdText}
              onChange={(e) => {
                setJdText(e.target.value);
                setError(null);
              }}
              placeholder="Paste the job description here... Include required and preferred skills, responsibilities, etc."
              className="textarea large"
            />

            <div className="input-actions">
              <input
                type="file"
                accept=".txt,.pdf"
                onChange={(e) => handleFileUpload(e, setJdText)}
                ref={jdRef}
                style={{ display: 'none' }}
              />
              <button
                className="btn btn-secondary"
                onClick={() => jdRef.current?.click()}
              >
                📁 Upload File
              </button>
            </div>
          </div>

          {/* Resume Input */}
          <div className="input-box">
            <label className="input-label">
              <div className="label-header">
                <span>👤 Resume / Profile</span>
                <span className="label-hint">Required</span>
              </div>
            </label>

            <textarea
              value={resumeText}
              onChange={(e) => {
                setResumeText(e.target.value);
                setError(null);
              }}
              placeholder="Paste your resume or profile here... Include your skills, experience, education, etc."
              className="textarea large"
            />

            <div className="input-actions">
              <input
                type="file"
                accept=".txt,.pdf"
                onChange={(e) => handleFileUpload(e, setResumeText)}
                ref={resumeRef}
                style={{ display: 'none' }}
              />
              <button
                className="btn btn-secondary"
                onClick={() => resumeRef.current?.click()}
              >
                📁 Upload File
              </button>
            </div>
          </div>
        </div>

        {/* Sample Data Button */}
        <div className="sample-data">
          <button className="btn btn-ghost" onClick={useSampleData}>
            💡 Use Sample Data (for testing)
          </button>
        </div>

        {/* Start Button */}
        <div className="action-buttons">
          <button
            className="btn btn-primary large"
            onClick={onStart}
            disabled={loading || !jdText.trim() || !resumeText.trim()}
          >
            {loading ? (
              <>
                <span className="spinner">⏳</span> Starting Assessment...
              </>
            ) : (
              <>🚀 Start Assessment</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ASSESSMENT STAGE COMPONENT
// ============================================================================

function AssessmentStage({ sessionId, onComplete }) {
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [userAnswer, setUserAnswer] = useState('');
  const [assessment, setAssessment] = useState(null);
  const [followUp, setFollowUp] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [assessedCount, setAssessedCount] = useState(0);
  const [totalSkills, setTotalSkills] = useState(0);
  const [conversationHistory, setConversationHistory] = useState([]);

  // Load first question on mount
  React.useEffect(() => {
    loadNextQuestion();
  }, []);

  const loadNextQuestion = async () => {
    setLoading(true);
    setError(null);
    setUserAnswer('');
    setAssessment(null);
    setFollowUp(null);

    try {
      const response = await assessmentAPI.getNextQuestion(sessionId);

      if (response.data.completed) {
        onComplete();
        return;
      }

      setCurrentQuestion(response.data);
      setTotalSkills(response.data.totalSkills);
      setAssessedCount(response.data.skillIndex);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load question');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitAnswer = async () => {
    if (!userAnswer.trim()) {
      setError('Please provide an answer');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await assessmentAPI.submitAnswer(
        sessionId,
        currentQuestion.skill,
        userAnswer
      );

      // Check the status to determine next action
      if (response.data.status === 'followup') {
        // FOLLOW-UP: Show follow-up question
        setFollowUp({
          question: response.data.followup_question,
          reason: response.data.followup_reason,
          attemptNumber: response.data.attemptNumber,
          interimScore: response.data.score,
          reasoning: response.data.reasoning,
        });
        setUserAnswer('');
      } else if (response.data.status === 'completed') {
        // COMPLETED: Skill fully assessed
        setAssessment(response.data);
        setAssessedCount(response.data.assessedCount);

        // Add to conversation history
        setConversationHistory([
          ...conversationHistory,
          {
            skill: currentQuestion.skill,
            question: currentQuestion.question,
            answer: userAnswer,
            followUp: followUp?.question || null,
            followUpAnswer: followUp ? userAnswer : null,
            assessment: response.data,
          },
        ]);

        // Auto load next question after 3 seconds
        setTimeout(() => {
          loadNextQuestion();
        }, 3000);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit answer');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stage assessing-stage">
      <div className="stage-container">
        {/* Progress Bar */}
        <div className="progress-section">
          <div className="progress-header">
            <h3>Assessment Progress</h3>
            <span className="progress-count">
              {assessedCount} / {totalSkills}
            </span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: `${totalSkills > 0 ? (assessedCount / totalSkills) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}

        {/* Current Question or Follow-up */}
        {currentQuestion && !assessment && (
          <div className="question-box">
            <div className="question-header">
              <span className="skill-badge">{currentQuestion.skill}</span>
              <span className="importance">
                Importance: {(currentQuestion.importance * 100).toFixed(0)}%
              </span>
              {followUp && (
                <span className="attempt-number">Attempt {followUp.attemptNumber}</span>
              )}
            </div>

            {!followUp && (
              <div className="question-meta">
                <span>
                  Candidate claim: <strong>{currentQuestion.candidateClaimed || 'unknown'}</strong>
                </span>
                <span>Job requires: <strong>{currentQuestion.jobRequires || 'not specified'}</strong></span>
              </div>
            )}

            {followUp && (
              <div className="followup-context">
                <p className="interim-feedback">
                  <strong>Initial assessment:</strong> {followUp.reasoning}
                </p>
                <p className="followup-reason">
                  <strong>Follow-up reason:</strong> {followUp.reason}
                </p>
              </div>
            )}

            <h2 className="question-text">
              {followUp ? followUp.question : currentQuestion.question}
            </h2>

            <textarea
              value={userAnswer}
              onChange={(e) => {
                setUserAnswer(e.target.value);
                setError(null);
              }}
              placeholder="Type your answer here..."
              className="textarea"
              disabled={loading}
            />

            <button
              className="btn btn-primary"
              onClick={handleSubmitAnswer}
              disabled={loading || !userAnswer.trim()}
            >
              {loading ? '⏳ Evaluating...' : followUp ? '✓ Submit Follow-up' : '✓ Submit Answer'}
            </button>
          </div>
        )}

        {/* Assessment Result */}
        {assessment && (
          <div className="assessment-result">
            <div className="result-header">
              <h3>{assessment.skill}</h3>
              <div className="score-badge" data-level={assessment.level}>
                {assessment.score}/100 • {assessment.level}
              </div>
            </div>

            <div className="result-content">
              <p className="reasoning">
                <strong>Assessment:</strong> {assessment.reasoning}
              </p>

              <div className="result-grid">
                <div className="result-box strengths">
                  <h4>💪 Strengths</h4>
                  <ul>
                    {assessment.strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>

                <div className="result-box gaps">
                  <h4>📚 Areas to Improve</h4>
                  <ul>
                    {assessment.gaps.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <p className="attempt-info">
                <small>Assessed in {assessment.totalAttempts} attempt{assessment.totalAttempts > 1 ? 's' : ''}</small>
              </p>

              <p className="next-action">
                {assessment.assessedCount === assessment.totalRequired
                  ? '✨ All skills assessed! Loading results...'
                  : 'Next question loading...'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// RESULTS STAGE COMPONENT
// ============================================================================

function ResultsStage({ sessionId, onRestart }) {
  const [summary, setSummary] = useState(null);
  const [learningPlan, setLearningPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  React.useEffect(() => {
    loadResults();
  }, []);

  const loadResults = async () => {
    setLoading(true);
    setError(null);

    try {
      const [summaryRes, planRes] = await Promise.all([
        assessmentAPI.getSummary(sessionId),
        assessmentAPI.getLearningPlan(sessionId),
      ]);

      setSummary(summaryRes.data);
      setLearningPlan(planRes.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load results');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="stage results-stage">
        <div className="stage-container">
          <div className="loading-state">
            <div className="spinner-large">⏳</div>
            <p>Generating your personalized learning plan...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stage results-stage">
        <div className="stage-container">
          <div className="error-message large">{error}</div>
          <button className="btn btn-primary" onClick={onRestart}>
            ↩️ Start Over
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stage results-stage">
      <div className="stage-container">
        <div className="results-header">
          <h2>📊 Assessment Results</h2>
          <p>Your personalized learning plan is ready</p>
        </div>

        {/* Tabs */}
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            📈 Overview
          </button>
          <button
            className={`tab ${activeTab === 'learning' ? 'active' : ''}`}
            onClick={() => setActiveTab('learning')}
          >
            📚 Learning Plan
          </button>
          <button
            className={`tab ${activeTab === 'details' ? 'active' : ''}`}
            onClick={() => setActiveTab('details')}
          >
            🔍 Details
          </button>
        </div>

        {/* Tab Content */}
        <div className="tab-content">
          {/* Overview Tab */}
          {activeTab === 'overview' && summary && (
            <div className="overview-tab">
              <div className="assessment-grid">
                {summary.assessedSkills &&
                  Object.entries(summary.assessedSkills).map(([skill, data]) => (
                    <div key={skill} className="skill-card" data-score={data.score}>
                      <div className="skill-card-header">
                        <h4>{skill}</h4>
                        <span className="score">{data.score}/100</span>
                      </div>
                      <p className="level">{data.level}</p>
                      <div className="score-bar">
                        <div
                          className="score-bar-fill"
                          style={{ width: `${data.score}%` }}
                        />
                      </div>
                      <p className="reasoning">{data.reasoning}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Learning Plan Tab */}
          {activeTab === 'learning' && learningPlan && (
            <div className="learning-tab">
              <div className="plan-header">
                <h3>Your Personalized Learning Path</h3>
                <div className="plan-stats">
                  <div className="stat">
                    <span className="label">Total Timeline</span>
                    <span className="value">
                      {learningPlan.learningPlan.total_timeline_weeks} weeks
                    </span>
                  </div>
                  <div className="stat">
                    <span className="label">Study Hours</span>
                    <span className="value">
                      {learningPlan.learningPlan.estimated_study_hours} hours
                    </span>
                  </div>
                  <div className="stat">
                    <span className="label">Can Parallelize</span>
                    <span className="value">
                      {learningPlan.learningPlan.can_parallelize ? '✅ Yes' : '❌ No'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="learning-items">
                {learningPlan.learningPlan.learning_path.map((item, idx) => (
                  <div key={idx} className="learning-item" data-priority={item.priority}>
                    <div className="learning-item-header">
                      <h4>
                        {idx + 1}. {item.skill}
                      </h4>
                      <span className="priority-badge">{item.priority}</span>
                    </div>

                    <p className="reason">{item.reason}</p>

                    <div className="level-range">
                      <span>Level: {item.current_level} → {item.target_level}</span>
                      <span className="weeks">⏱️ {item.weeks_needed} weeks</span>
                    </div>

                    <div className="resources">
                      <h5>📖 Resources:</h5>
                      {item.resources && item.resources.length > 0 ? (
                        <ul>
                          {item.resources.slice(0, 4).map((res, i) => (
                            <li key={i}>
                              {res.title ? (
                                <>
                                  <strong>{res.title}</strong>
                                  <span className="meta">
                                    {res.type || 'course'} • {res.hours || 0}h
                                  </span>
                                  {res.description && (
                                    <p className="description">{res.description}</p>
                                  )}
                                </>
                              ) : (
                                <span className="empty">No resource details available</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="no-resources">No specific resources generated</p>
                      )}
                    </div>

                    {item.resource_hours && (
                      <div className="resource-summary">
                        <small>📚 Total hours for this skill: <strong>{item.resource_hours} hours</strong></small>
                      </div>
                    )}

                    {item.adjacent_skills && item.adjacent_skills.length > 0 && (
                      <div className="adjacent">
                        <strong>Next steps:</strong> {item.adjacent_skills.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="plan-summary">
                <p>{learningPlan.learningPlan.summary}</p>
              </div>
            </div>
          )}

          {/* Details Tab */}
          {activeTab === 'details' && summary && (
            <div className="details-tab">
              <div className="details-grid">
                <div className="detail-section">
                  <h4>📋 JD Requirements</h4>
                  <div className="skills-list">
                    {summary.jdSkills.required_skills.map((skill, i) => (
                      <div key={i} className="skill-item">
                        <span>{skill.skill}</span>
                        <span className="importance">
                          {(skill.importance * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="detail-section">
                  <h4>👤 Your Skills</h4>
                  <div className="skills-list">
                    {summary.resumeSkills.skills.slice(0, 5).map((skill, i) => (
                      <div key={i} className="skill-item">
                        <span>{skill.skill}</span>
                        <span className="proficiency">
                          {skill.proficiency}
                          {skill.years ? ` • ${skill.years} yrs` : ''}
                          {skill.inferred ? ' • inferred' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {summary.gapAnalysis && summary.gapAnalysis.length > 0 && (
                <div className="details-grid gap-analysis">
                  <div className="detail-section">
                    <h4>📉 Skill Gap Analysis</h4>
                    <div className="skills-list">
                      {summary.gapAnalysis.map((gap, index) => (
                        <div key={index} className="skill-item">
                          <span>{gap.skill}</span>
                          <span className="proficiency">
                            {gap.meetsRequirement
                              ? 'Matches requirement'
                              : gap.candidateClaimed === 'unknown'
                              ? 'Unknown fit'
                              : 'Needs improvement'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="results-actions">
          <button className="btn btn-secondary" onClick={onRestart}>
            ↩️ Assess Another Role
          </button>
          <button className="btn btn-primary" onClick={() => window.print()}>
            🖨️ Download Results
          </button>
        </div>
      </div>
    </div>
  );
}
