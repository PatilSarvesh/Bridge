"use client";

import { useState } from "react";

import { BridgeIcon } from "./bridge-icon";
import { guideChecklist, guideModes, guideStarterPrompt, guideSteps, guideTroubleshooting } from "./user-guide-content";

function CopyButton({ value }: Readonly<{ value: string }>) {
  const [copied, setCopied] = useState(false);

  const copyValue = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      className="guide-copy"
      type="button"
      aria-label={copied ? "Copied" : "Copy code"}
      onClick={() => void copyValue()}
    >
      <BridgeIcon name={copied ? "decisions" : "copy"} size={15} />
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function GuideCode({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <figure className="guide-code">
      <figcaption>
        <span>{label}</span>
        <CopyButton value={value} />
      </figcaption>
      <pre>
        <code>{value}</code>
      </pre>
    </figure>
  );
}

export function UserGuide() {
  return (
    <div className="guide-page">
      <section className="guide-hero" aria-labelledby="user-guide-title">
        <div className="guide-hero-copy">
          <span className="page-eyebrow">Getting started</span>
          <h1 id="user-guide-title">Connect Bridge to your project</h1>
          <p>
            Set up the thinnest adapter your team needs, let agents work normally, and bring shared decisions back to
            the people who own them.
          </p>
          <div className="guide-hero-actions">
            <a className="primary guide-button" href="#guide-steps">
              Start with the recommended path <BridgeIcon name="chevron" size={15} />
            </a>
            <a className="secondary guide-button" href="#guide-options">
              See optional paths
            </a>
          </div>
        </div>
        <aside className="guide-hero-aside" aria-label="Recommended setup summary">
          <span className="guide-aside-icon">
            <BridgeIcon name="guide" size={19} />
          </span>
          <span className="guide-aside-label">Recommended setup</span>
          <strong>CLI over REST</strong>
          <p>No MCP approval or database is required for the first local walkthrough.</p>
          <div className="guide-hero-meta">
            <span>6 steps</span>
            <span>Human review included</span>
          </div>
        </aside>
      </section>

      <div className="guide-layout">
        <section className="guide-main" id="guide-steps" aria-labelledby="guide-steps-title">
          <div className="guide-section-heading">
            <div>
              <span className="guide-section-kicker">Recommended path</span>
              <h2 id="guide-steps-title">From a fresh repository to a governed handoff</h2>
            </div>
            <p>
              Follow these steps once for each project. The Bridge service stays shared; the project-owned adapter stays
              in the repository.
            </p>
          </div>
          <ol className="guide-step-list">
            {guideSteps.map((step) => (
              <li className="guide-step" key={step.number}>
                <span className="guide-step-number" aria-hidden="true">
                  {step.number}
                </span>
                <div className="guide-step-body">
                  <div className="guide-step-heading">
                    <div>
                      <span>{step.eyebrow}</span>
                      <h3>{step.title}</h3>
                    </div>
                    <span className="guide-step-status">Step {Number(step.number)}</span>
                  </div>
                  <p>{step.description}</p>
                  {step.code ? <GuideCode label={step.codeLabel ?? "Command"} value={step.code} /> : null}
                  {step.note ? (
                    <p className="guide-step-note">
                      <BridgeIcon name="guide" size={16} />
                      <span>{step.note}</span>
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <aside className="guide-rail" aria-label="User guide overview">
          <section className="guide-rail-card guide-checklist">
            <div className="guide-card-heading">
              <span className="guide-card-icon">
                <BridgeIcon name="decisions" size={16} />
              </span>
              <div>
                <span>Quick check</span>
                <h2>Before you start</h2>
              </div>
            </div>
            <ul>
              {guideChecklist.map((item) => (
                <li key={item}>
                  <BridgeIcon name="decisions" size={15} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
          <nav className="guide-rail-card guide-map" aria-label="Guide sections">
            <div className="guide-card-heading">
              <span className="guide-card-icon">
                <BridgeIcon name="guide" size={16} />
              </span>
              <div>
                <span>Guide map</span>
                <h2>Keep the path light</h2>
              </div>
            </div>
            <a href="#guide-steps">
              <span>01</span>
              <strong>Recommended path</strong>
              <BridgeIcon name="chevron" size={14} />
            </a>
            <a href="#guide-options">
              <span>02</span>
              <strong>Optional setup</strong>
              <BridgeIcon name="chevron" size={14} />
            </a>
            <a href="#guide-troubleshooting">
              <span>03</span>
              <strong>Troubleshooting</strong>
              <BridgeIcon name="chevron" size={14} />
            </a>
          </nav>
          <section className="guide-rail-card guide-authority">
            <span className="guide-section-kicker">Authority boundary</span>
            <h2>People stay in control</h2>
            <p>
              Agents can recommend, ask, and publish drafts. Only an authorized human can accept a decision or approve a
              specification version.
            </p>
          </section>
        </aside>
      </div>

      <section className="guide-section" id="guide-options" aria-labelledby="guide-options-title">
        <div className="guide-section-heading">
          <div>
            <span className="guide-section-kicker">Choose only what you need</span>
            <h2 id="guide-options-title">Optional paths stay out of your way</h2>
          </div>
          <p>
            Start with CLI + REST. Expand only when your team has a clear reason to add another transport or durable
            local state.
          </p>
        </div>
        <div className="guide-option-list">
          {guideModes.map((mode) => (
            <details className="guide-option" key={mode.key}>
              <summary>
                <span className="guide-option-icon">
                  <BridgeIcon
                    name={mode.key === "mcp" ? "bridge" : mode.key === "postgresql" ? "repositories" : "guide"}
                    size={17}
                  />
                </span>
                <span className="guide-option-copy">
                  <strong>{mode.label}</strong>
                  <small>{mode.description}</small>
                </span>
                <span className="guide-option-badge">{mode.eyebrow}</span>
                <BridgeIcon name="chevron" size={16} className="guide-option-chevron" />
              </summary>
              <div className="guide-option-body">
                <p>{mode.detail}</p>
                {mode.code ? <GuideCode label={mode.codeLabel ?? "Command"} value={mode.code} /> : null}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="guide-section" id="guide-troubleshooting" aria-labelledby="guide-troubleshooting-title">
        <div className="guide-section-heading">
          <div>
            <span className="guide-section-kicker">When setup gets noisy</span>
            <h2 id="guide-troubleshooting-title">Troubleshooting without losing the boundary</h2>
          </div>
          <p>
            Resolve connectivity and environment issues at the adapter boundary. Do not replace Bridge records with a
            private prompt or an unreviewed local decision.
          </p>
        </div>
        <div className="guide-troubleshooting-list">
          {guideTroubleshooting.map((item) => (
            <details key={item.problem}>
              <summary>
                <span>{item.problem}</span>
                <BridgeIcon name="chevron" size={15} />
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="guide-next" aria-labelledby="guide-next-title">
        <div>
          <span className="guide-section-kicker">Ready for the first run?</span>
          <h2 id="guide-next-title">Use your own project language</h2>
          <p>
            The best first test is an ordinary request. Bridge will make the governed handoff visible when the work
            needs a human decision.
          </p>
        </div>
        <GuideCode label="Example request" value={guideStarterPrompt} />
      </section>
    </div>
  );
}
