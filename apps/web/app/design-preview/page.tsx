"use client";

import { useState } from "react";
import styles from "./design-preview.module.css";

type WorkspaceView = "Review" | "Knowledge" | "Runs";

type Question = {
  id: string;
  category: string;
  title: string;
  summary: string;
  owner: string;
  risk: "open" | "protected";
  recommendation: string;
  options: Array<{ key: string; label: string; detail: string }>;
};

const questions: Question[] = [
  {
    id: "q-01",
    category: "Architecture / Transfers",
    title: "Which transfer failures should trigger an automatic retry?",
    summary: "The current implementation treats every non-success response as retryable.",
    owner: "Architecture owner",
    risk: "open",
    recommendation: "transient",
    options: [
      { key: "transient", label: "Retry transient failures only", detail: "Needs error classification, but avoids useless retries." },
      { key: "all", label: "Retry all failures", detail: "Simpler implementation, but may repeat invalid requests." },
    ],
  },
  {
    id: "q-02",
    category: "Product / Onboarding",
    title: "Should invite links expire after seven days?",
    summary: "The onboarding flow currently leaves invitation links active until they are used.",
    owner: "Product owner",
    risk: "open",
    recommendation: "seven-days",
    options: [
      { key: "seven-days", label: "Expire links after seven days", detail: "Limits stale access without adding another user step." },
      { key: "never", label: "Keep links active until used", detail: "Fewer support cases, but a larger security window." },
    ],
  },
  {
    id: "q-03",
    category: "Security / Authentication",
    title: "Do administrator accounts require passkeys?",
    summary: "The security baseline supports passkeys, but the administrator policy is not yet explicit.",
    owner: "Security reviewer",
    risk: "protected",
    recommendation: "require",
    options: [
      { key: "require", label: "Require passkeys for administrators", detail: "Stronger protection for the highest-impact accounts." },
      { key: "offer", label: "Offer passkeys as an option", detail: "Easier rollout, but leaves enforcement to each person." },
    ],
  },
];

export default function DesignPreviewPage() {
  const [view, setView] = useState<WorkspaceView>("Review");
  const [selectedQuestionId, setSelectedQuestionId] = useState("q-01");
  const [selectedOption, setSelectedOption] = useState("transient");
  const [saved, setSaved] = useState(false);
  const selectedQuestion = questions.find((question) => question.id === selectedQuestionId) ?? questions[0]!;

  const openQuestion = (question: Question) => {
    setSelectedQuestionId(question.id);
    setSelectedOption(question.recommendation);
    setSaved(false);
  };

  return (
    <main className={styles.studio}>
      <header className={styles.header}>
        <div className={styles.wordmark}><span className={styles.wordmarkMark}>B</span><span>Bridge</span><small>Decision studio</small></div>
        <nav className={styles.primaryNav} aria-label="Workspace navigation">
          {(["Review", "Knowledge", "Runs"] as WorkspaceView[]).map((item) => (
            <button className={view === item ? styles.navActive : styles.navButton} type="button" key={item} onClick={() => setView(item)} aria-current={view === item ? "page" : undefined}>{item}</button>
          ))}
        </nav>
        <div className={styles.headerTools}><button className={styles.projectButton} type="button"><span className={styles.projectDot}>P</span> Payments Platform <span className={styles.down}>⌄</span></button><span className={styles.headerDivider} /><button className={styles.avatar} type="button" aria-label="Open Sarvesh Patil profile">SP</button></div>
      </header>

      {view === "Review" ? (
        <div className={styles.page}>
          <div className={styles.pageIntro}>
            <div><span className={styles.kicker}>Tuesday, August 18 · Human review</span><h1>Review queue <span>04</span></h1><p>Make the decisions that keep the project moving.</p></div>
            <div className={styles.introAside}><span className={styles.liveDot} /> All systems synced <button type="button" className={styles.shortcut}>⌘ K</button></div>
          </div>

          <div className={styles.reviewGrid}>
            <aside className={styles.queuePane} aria-label="Open decision queue">
              <div className={styles.queueHeader}><div><span className={styles.kicker}>Open queue</span><h2>Needs your answer</h2></div><span className={styles.queueCount}>4</span></div>
              <div className={styles.queueList}>
                {questions.map((question, index) => (
                  <button className={selectedQuestion.id === question.id ? styles.queueItemActive : styles.queueItem} type="button" key={question.id} onClick={() => openQuestion(question)}>
                    <span className={styles.queueIndex}>0{index + 1}</span>
                    <span className={styles.queueCopy}><span className={styles.queueCategory}>{question.category}</span><strong>{question.title}</strong><span className={styles.queueState}>{question.risk === "protected" ? "Protected" : index === 0 ? "Next up" : "Waiting"}</span></span>
                    <span className={styles.arrow}>↗</span>
                  </button>
                ))}
              </div>
              <div className={styles.queueFoot}><span>1 protected question</span><button type="button">View all <span>→</span></button></div>
            </aside>

            <section className={styles.canvas} aria-labelledby="question-heading">
              <div className={styles.canvasTop}><span className={styles.canvasId}>{selectedQuestion.id} / {selectedQuestion.category}</span><span className={selectedQuestion.risk === "protected" ? styles.protectedTag : styles.openTag}>{selectedQuestion.risk === "protected" ? "Protected review" : "Open"}</span></div>
              <div className={styles.canvasTitle}><span className={styles.canvasNumber}>{selectedQuestion.id.replace("q-", "")}</span><div><h2 id="question-heading">{selectedQuestion.title}</h2><p>{selectedQuestion.summary}</p></div></div>
              <div className={styles.metaRow}><span><small>Routed to</small><strong>{selectedQuestion.owner}</strong></span><span><small>Raised by</small><strong>Codex · 12 min ago</strong></span><span><small>Authority</small><strong>Human decision</strong></span></div>

              <div className={styles.answerBlock}><div className={styles.answerHeading}><span>Choose an answer</span><small>Agent recommendation is marked</small></div><div className={styles.optionList}>
                {selectedQuestion.options.map((option, index) => (
                  <button className={selectedOption === option.key ? styles.optionActive : styles.option} type="button" key={option.key} onClick={() => { setSelectedOption(option.key); setSaved(false); }} aria-pressed={selectedOption === option.key}>
                    <span className={styles.optionNo}>0{index + 1}</span><span className={styles.optionCopy}><strong>{option.label}</strong><small>{option.detail}</small></span>{option.key === selectedQuestion.recommendation ? <em>Agent recommends</em> : null}<span className={styles.optionRadio}>{selectedOption === option.key ? "✓" : ""}</span>
                  </button>
                ))}
              </div></div>

              <details className={styles.contextDisclosure}><summary>Why this decision is here <span>+</span></summary><div><p>Permanent failures should return quickly while transient failures can be retried with bounded backoff and idempotency keys.</p><span className={styles.sourceLabel}>Source · agent run checkout-reliability-12</span></div></details>
              <footer className={styles.canvasFooter}><span><span className={styles.humanMark}>●</span> People retain approval authority</span><button className={saved ? styles.savedButton : styles.saveButton} type="button" onClick={() => setSaved(true)}>{saved ? "Draft saved" : "Save answer draft"}<span>→</span></button></footer>
            </section>
          </div>
        </div>
      ) : (
        <div className={styles.placeholder}>
          <span className={styles.placeholderIcon}>{view === "Knowledge" ? "⌘" : "↗"}</span><span className={styles.kicker}>{view} workspace</span><h1>Keep the next surface quiet.</h1><p>This concept keeps {view.toLowerCase()} focused and makes the review queue the primary Bridge workflow.</p><button className={styles.saveButton} type="button" onClick={() => setView("Review")}>Back to review <span>→</span></button>
        </div>
      )}
    </main>
  );
}
