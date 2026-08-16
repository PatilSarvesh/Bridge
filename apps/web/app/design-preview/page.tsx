"use client";

import { useState } from "react";
import styles from "./design-preview.module.css";

type Section = "Review" | "Library" | "Runs";

const queue = [
  { eyebrow: "Architecture · Transfers", title: "Which transfer failures should trigger an automatic retry?", state: "Next", tone: "lime" },
  { eyebrow: "Product · Onboarding", title: "Should invite links expire after seven days?", state: "Waiting", tone: "coral" },
  { eyebrow: "Security · Authentication", title: "Do we require passkeys for administrator accounts?", state: "Protected", tone: "ink" },
];

const activity = [
  { marker: "01", title: "A new decision is ready", detail: "Retry policy · raised by Codex", time: "12 min" },
  { marker: "02", title: "Specification moved to review", detail: "Payments API contract · v4", time: "44 min" },
  { marker: "03", title: "Agent run completed", detail: "Checkout reliability · waiting for context", time: "2 hr" },
];

export default function DesignPreviewPage() {
  const [section, setSection] = useState<Section>("Review");
  const [selectedOption, setSelectedOption] = useState("transient");
  const [recorded, setRecorded] = useState(false);

  return (
    <main className={styles.preview}>
      <aside className={styles.rail} aria-label="Preview navigation">
        <div className={styles.logo} aria-label="Bridge">B</div>
        <div className={styles.railStack}>
          <button className={`${styles.railButton} ${styles.railButtonActive}`} type="button" aria-label="Review" aria-current="page">◒</button>
          <button className={styles.railButton} type="button" aria-label="Library">▤</button>
          <button className={styles.railButton} type="button" aria-label="Runs">↗</button>
        </div>
        <button className={styles.railButton} type="button" aria-label="Settings">⌁</button>
      </aside>

      <aside className={styles.context}>
        <div className={styles.contextTop}>
          <span className={styles.overline}>Bridge / concept</span>
          <span className={styles.previewPill}>Preview</span>
        </div>
        <div className={styles.workspaceName}>
          <span className={styles.workspaceMark}>P</span>
          <span>
            <strong>Payments Platform</strong>
            <small>Product workspace</small>
          </span>
          <span className={styles.chevron}>⌄</span>
        </div>

        <nav className={styles.sectionNav} aria-label="Preview sections">
          <span className={styles.navCaption}>Workspace</span>
          {(["Review", "Library", "Runs"] as Section[]).map((item) => (
            <button
              className={section === item ? styles.sectionButtonActive : styles.sectionButton}
              type="button"
              key={item}
              onClick={() => setSection(item)}
              aria-current={section === item ? "page" : undefined}
            >
              <span>{item}</span>
              {item === "Review" ? <b>4</b> : item === "Library" ? <b>2</b> : <b>7</b>}
            </button>
          ))}
        </nav>

        <div className={styles.contextNote}>
          <span className={styles.noteDot} />
          <p><strong>Human review</strong> stays the final step.</p>
        </div>

        <div className={styles.profile}>
          <span className={styles.avatar}>SP</span>
          <span><strong>Sarvesh Patil</strong><small>Project admin</small></span>
          <span className={styles.more}>···</span>
        </div>
      </aside>

      <section className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}><span>Payments Platform</span><i>/</i><strong>{section}</strong></div>
          <div className={styles.topbarActions}><span className={styles.sync}><span />Synced 2 min ago</span><button className={styles.helpButton} type="button" aria-label="Help">?</button></div>
        </header>

        {section === "Review" ? (
          <div className={styles.mainContent}>
            <div className={styles.intro}>
              <div>
                <span className={styles.overline}>Tuesday, August 18 · Decision desk</span>
                <h1>Good morning, Sarvesh<span>.</span></h1>
                <p>Here are the few things that need a human point of view.</p>
              </div>
              <button className={styles.ghostButton} type="button">⌘ K <span>Quick find</span></button>
            </div>

            <div className={styles.statRow} aria-label="Workspace summary">
              <div className={styles.stat}><span>Needs a decision</span><strong>4</strong><small>1 protected</small></div>
              <div className={styles.stat}><span>Specifications</span><strong>2</strong><small>Ready for review</small></div>
              <div className={styles.stat}><span>Active agent runs</span><strong>7</strong><small>Across this project</small></div>
            </div>

            <div className={styles.contentGrid}>
              <section className={styles.decisionCard} aria-labelledby="next-decision-heading">
                <div className={styles.cardTopline}><span className={`${styles.statusTag} ${styles.statusTagCoral}`}>NEXT DECISION</span><span className={styles.cardMeta}>Architecture · Transfers</span></div>
                <div className={styles.questionHeader}>
                  <span className={styles.questionNumber}>01</span>
                  <div><h2 id="next-decision-heading">Which transfer failures should trigger an automatic retry?</h2><p>The current implementation treats every non-success response as retryable.</p></div>
                </div>

                <div className={styles.choiceHeader}><span>Choose the answer you can stand behind</span><span>Agent recommendation marked</span></div>
                <div className={styles.choices}>
                  <button className={selectedOption === "transient" ? styles.choiceSelected : styles.choice} type="button" onClick={() => { setSelectedOption("transient"); setRecorded(false); }} aria-pressed={selectedOption === "transient"}>
                    <span className={styles.radio}>{selectedOption === "transient" ? "✓" : ""}</span>
                    <span><strong>Retry transient failures only</strong><small>Requires error classification, but avoids useless retries.</small></span>
                    <em>Recommended</em>
                  </button>
                  <button className={selectedOption === "all" ? styles.choiceSelected : styles.choice} type="button" onClick={() => { setSelectedOption("all"); setRecorded(false); }} aria-pressed={selectedOption === "all"}>
                    <span className={styles.radio}>{selectedOption === "all" ? "✓" : ""}</span>
                    <span><strong>Retry all failures</strong><small>Simpler implementation, but may repeat invalid requests.</small></span>
                  </button>
                </div>
                <div className={styles.cardFooter}>
                  <span className={styles.authorityNote}><span className={styles.dot} />Human approval required</span>
                  <button className={recorded ? styles.recordedButton : styles.primaryButton} type="button" onClick={() => setRecorded(true)}>{recorded ? "Recommendation recorded" : "Record recommendation"}<span>→</span></button>
                </div>
              </section>

              <aside className={styles.sideColumn}>
                <section className={styles.nowCard} aria-labelledby="now-heading">
                  <div className={styles.sideHeading}><h2 id="now-heading">What’s happening</h2><button type="button" className={styles.textButton}>View all</button></div>
                  <div className={styles.activityList}>
                    {activity.map((item) => <div className={styles.activityItem} key={item.marker}><span className={styles.activityMarker}>{item.marker}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{item.time}</time></div>)}
                  </div>
                </section>
                <section className={styles.principleCard}>
                  <span className={styles.principleMark}>✦</span>
                  <span className={styles.overline}>Bridge principle</span>
                  <p>Agents can recommend. People decide.</p>
                </section>
              </aside>
            </div>

            <section className={styles.queueSection} aria-labelledby="queue-heading">
              <div className={styles.sectionHeading}><div><span className={styles.overline}>The rest of the queue</span><h2 id="queue-heading">Coming up next</h2></div><button className={styles.textButton} type="button">Open full queue <span>→</span></button></div>
              <div className={styles.queueGrid}>{queue.slice(1).map((item) => <button className={styles.queueCard} type="button" key={item.title}><span className={`${styles.queueTone} ${item.tone === "coral" ? styles.queueToneCoral : styles.queueToneInk}`} /><span><small>{item.eyebrow}</small><strong>{item.title}</strong></span><span className={styles.queueState}>{item.state} <b>→</b></span></button>)}</div>
            </section>
          </div>
        ) : (
          <div className={styles.emptySection}>
            <span className={styles.emptyGlyph}>{section === "Library" ? "▤" : "↗"}</span>
            <span className={styles.overline}>{section} concept</span>
            <h1>A quieter place for {section.toLowerCase()}.</h1>
            <p>This prototype keeps the same visual language while exploring the {section.toLowerCase()} workspace as a separate, focused surface.</p>
            <button className={styles.primaryButton} type="button" onClick={() => setSection("Review")}>Back to review <span>→</span></button>
          </div>
        )}
      </section>
    </main>
  );
}
