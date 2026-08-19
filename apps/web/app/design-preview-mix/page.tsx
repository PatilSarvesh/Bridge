"use client";

import { useState } from "react";
import styles from "./design-preview-mix.module.css";

type Question = {
  id: string;
  category: string;
  title: string;
  summary: string;
  state: string;
  option: string;
  options: Array<{ key: string; label: string; detail: string }>;
};

const questions: Question[] = [
  {
    id: "q-01",
    category: "Architecture · Transfers",
    title: "Which transfer failures should trigger an automatic retry?",
    summary: "The current implementation treats every non-success response as retryable.",
    state: "Next up",
    option: "transient",
    options: [
      { key: "transient", label: "Retry transient failures only", detail: "Needs error classification, but avoids useless retries." },
      { key: "all", label: "Retry all failures", detail: "Simpler implementation, but may repeat invalid requests." },
    ],
  },
  {
    id: "q-02",
    category: "Product · Onboarding",
    title: "Should invite links expire after seven days?",
    summary: "The onboarding flow currently leaves invitation links active until they are used.",
    state: "Waiting",
    option: "seven-days",
    options: [
      { key: "seven-days", label: "Expire links after seven days", detail: "Limits stale access without adding another user step." },
      { key: "never", label: "Keep links active until used", detail: "Fewer support cases, but a larger security window." },
    ],
  },
  {
    id: "q-03",
    category: "Security · Authentication",
    title: "Do administrator accounts require passkeys?",
    summary: "The security baseline supports passkeys, but the administrator policy is not yet explicit.",
    state: "Protected",
    option: "require",
    options: [
      { key: "require", label: "Require passkeys for administrators", detail: "Stronger protection for the highest-impact accounts." },
      { key: "offer", label: "Offer passkeys as an option", detail: "Easier rollout, but leaves enforcement to each person." },
    ],
  },
];

const navGroups = [
  { label: "Work", items: [["Inbox", "4"], ["Questions", ""], ["Notifications", "1"]] },
  { label: "Knowledge", items: [["Decisions", ""], ["Specifications", "2"], ["Assumptions", ""], ["Agent runs", ""]] },
  { label: "Admin", items: [["Repositories", ""], ["Organization", ""], ["Analytics", ""]] },
];

export default function DesignPreviewMixPage() {
  const [selectedId, setSelectedId] = useState("q-01");
  const [selectedOption, setSelectedOption] = useState("transient");
  const [saved, setSaved] = useState(false);
  const selected = questions.find((question) => question.id === selectedId) ?? questions[0]!;

  const selectQuestion = (question: Question) => {
    setSelectedId(question.id);
    setSelectedOption(question.option);
    setSaved(false);
  };

  return (
    <main className={styles.hybrid}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}><span>B</span><strong>Bridge</strong><small>Design preview</small></div>
        <div className={styles.projectBlock}><small>Project</small><button type="button"><span className={styles.projectMark}>P</span>Payments Platform<span className={styles.chevron}>⌄</span></button></div>
        <div className={styles.reviewerBlock}><small>Reviewing as</small><strong>Sarvesh Patil</strong><span>architecture-owner · project-admin</span></div>
        <nav className={styles.sideNav} aria-label="Bridge navigation">
          {navGroups.map((group) => <div className={styles.navGroup} key={group.label}><span className={styles.navLabel}>{group.label}</span>{group.items.map(([label, count]) => <button className={label === "Inbox" ? styles.sideNavActive : styles.sideNavButton} type="button" key={label}>{label}{count ? <b>{count}</b> : null}</button>)}</div>)}
        </nav>
        <div className={styles.identity}><span className={styles.identityAvatar}>SP</span><span><strong>Sarvesh Patil</strong><small>Development identity</small></span><span className={styles.more}>···</span></div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}><div className={styles.crumbs}><span>Payments Platform</span><i>/</i><strong>Inbox</strong></div><div className={styles.topTools}><span className={styles.synced}><span /> Synced 2 min ago</span><button className={styles.help} type="button" aria-label="Help">?</button><button className={styles.topAvatar} type="button" aria-label="Open profile">SP</button></div></header>
        <div className={styles.content}>
          <div className={styles.intro}><div><span className={styles.kicker}>Tuesday, August 18 · Human review</span><h1>Keep the work moving<span>.</span></h1><p>A focused queue for the decisions only people can make.</p></div><button className={styles.quickFind} type="button">⌘ K <span>Quick find</span></button></div>

          <div className={styles.hybridGrid}>
            <section className={styles.queue} aria-label="Open question queue">
              <div className={styles.queueHead}><div><span className={styles.kicker}>Open queue</span><h2>Needs your answer</h2></div><span className={styles.queueCount}>4</span></div>
              <div className={styles.queueItems}>{questions.map((question, index) => <button className={question.id === selected.id ? styles.queueItemActive : styles.queueItem} type="button" key={question.id} onClick={() => selectQuestion(question)}><span className={styles.queueNumber}>0{index + 1}</span><span className={styles.queueBody}><small>{question.category}</small><strong>{question.title}</strong><em>{question.state}</em></span><span className={styles.queueArrow}>↗</span></button>)}</div>
              <div className={styles.queueFooter}><span>1 protected question</span><button type="button">View all <span>→</span></button></div>
            </section>

            <section className={styles.decision} aria-labelledby="mixed-question-heading">
              <div className={styles.decisionTop}><span>{selected.id} · {selected.category}</span><span className={styles.openStatus}>{selected.state === "Protected" ? "Protected review" : "Open"}</span></div>
              <div className={styles.decisionTitle}><span className={styles.decisionNumber}>{selected.id.replace("q-", "")}</span><div><h2 id="mixed-question-heading">{selected.title}</h2><p>{selected.summary}</p></div></div>
              <div className={styles.meta}><span><small>Routed to</small><strong>Architecture owner</strong></span><span><small>Raised by</small><strong>Codex · 12 min ago</strong></span><span><small>Authority</small><strong>Human decision</strong></span></div>
              <div className={styles.answerArea}><div className={styles.answerTitle}><strong>Choose an answer</strong><span>Agent recommendation marked</span></div><div className={styles.options}>{selected.options.map((option, index) => <button className={selectedOption === option.key ? styles.optionActive : styles.option} type="button" key={option.key} onClick={() => { setSelectedOption(option.key); setSaved(false); }} aria-pressed={selectedOption === option.key}><span className={styles.optionNumber}>0{index + 1}</span><span><strong>{option.label}</strong><small>{option.detail}</small></span>{option.key === selected.option ? <em>Recommended</em> : null}<span className={styles.radio}>{selectedOption === option.key ? "✓" : ""}</span></button>)}</div></div>
              <details className={styles.context}><summary>Why this decision is here <span>+</span></summary><div><p>Permanent failures should return quickly while transient failures can be retried with bounded backoff and idempotency keys.</p><small>Source · agent run checkout-reliability-12</small></div></details>
              <footer className={styles.decisionFooter}><span><b>●</b> People retain approval authority</span><button className={saved ? styles.saved : styles.save} type="button" onClick={() => setSaved(true)}>{saved ? "Draft saved" : "Save answer draft"}<span>→</span></button></footer>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
