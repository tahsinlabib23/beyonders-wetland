"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type WalkthroughStep = {
  title: string;
  target: string;
  explanation: string;
};

const WORLD_STEPS: WalkthroughStep[] = [
  {
    title: "Start with worldwide observations",
    target: "global-nisar-map",
    explanation: "The mosaic shows NISAR radar observations and the outlines show acquired scenes. Neither layer is a flood classification. Blank areas have no project result available.",
  },
];

const REFERENCE_CASE_STEP: WalkthroughStep = {
  title: "See an independent event example",
  target: "mozambique-case-title",
  explanation: "The Chókwè section shows the local NISAR BETA result, an inconclusive HLS check, and later UNOSAT Sentinel-1 water layers that spatially overlap many candidates. The reference dates are six to seven days later and preliminary, so this is supporting context rather than an accuracy score or confirmation.",
};

function studySteps(hasRun: boolean): WalkthroughStep[] {
  if (!hasRun) {
    return [
      ...WORLD_STEPS,
      {
        title: "Choose a processed study",
        target: "nisar-run-controls",
        explanation: "Select a saved run here when one is available. A candidate layer only covers that run’s study boundary and selected observation date.",
      },
      {
        title: "Prepare another study",
        target: "nisar-process",
        explanation: "This section explains how studies are prepared and published. Processing uses the operator’s local environment and Earthdata access; the public viewer only reads published studies.",
      },
      REFERENCE_CASE_STEP,
    ];
  }

  return [
    ...WORLD_STEPS,
    {
      title: "Check the selected run and method",
      target: "nisar-run-controls",
      explanation: "Confirm the study area, input dates, NISAR product, polarizations, and change rules. These choices define what the candidate layer can represent.",
    },
    {
      title: "Inspect the radar change",
      target: "nisar-radar",
      explanation: "Compare baseline, later observation, and their difference for HH or HV. A darker return is a radar response; by itself it does not prove new floodwater.",
    },
    {
      title: "Compare independent optical evidence",
      target: "nisar-reference-evidence",
      explanation: "Check the HLS dates, clear coverage, agreement map, and disagreement categories. Low coverage or weak overlap leaves the result inconclusive or unverified.",
    },
    {
      title: "Read the case claim and uncertainty",
      target: "nisar-case-story-title",
      explanation: "The case card records the measured candidate area, method, reference status, and sensitivity. Treat candidates as places to investigate, not confirmed flooding.",
    },
    REFERENCE_CASE_STEP,
  ];
}

export default function CaseWalkthrough({ hasRun }: { hasRun: boolean }) {
  const steps = useMemo(() => studySteps(hasRun), [hasRun]);
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const launchRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const currentStepIndex = Math.min(stepIndex, steps.length - 1);
  const current = steps[currentStepIndex];

  useEffect(() => {
    if (open) headingRef.current?.focus();
    else if (wasOpen.current) launchRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open || !current) return;
    const target = document.getElementById(current.target);
    if (!target) {
      window.dispatchEvent(new CustomEvent("geonexsar:open-panel", { detail: current.target }));
      return;
    }
    target.classList.add("case-walkthrough-highlight");
    target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center",
    });
    return () => target.classList.remove("case-walkthrough-highlight");
  }, [current, open]);

  function start() {
    setStepIndex(0);
    setOpen(true);
  }

  function move(direction: -1 | 1) {
    if (direction === 1 && currentStepIndex === steps.length - 1) {
      setOpen(false);
      return;
    }
    setStepIndex(Math.max(0, Math.min(steps.length - 1, currentStepIndex + direction)));
  }

  return (
    <>
      <section className="case-walkthrough-launch" aria-label="Guided wetland case walkthrough">
        <div>
          <strong>New to this map?</strong>
          <p>Follow the observations, processed case, and independent evidence in a few short steps.</p>
        </div>
        <button ref={launchRef} type="button" onClick={start}>Start case walkthrough</button>
      </section>

      {open && current && typeof document !== "undefined" && createPortal((
        <aside className="case-walkthrough" aria-labelledby="case-walkthrough-title" aria-live="polite">
          <div className="case-walkthrough__topline">
            <span>WETLAND CASE GUIDE</span>
            <button type="button" className="case-walkthrough__close" onClick={() => setOpen(false)} aria-label="Close walkthrough">×</button>
          </div>
          <div className="case-walkthrough__progress" role="progressbar" aria-label="Walkthrough progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={currentStepIndex + 1}>
            {steps.map((item, index) => <span key={item.title} className={index <= currentStepIndex ? "is-complete" : ""} />)}
          </div>
          <p className="case-walkthrough__count">Step {currentStepIndex + 1} of {steps.length}</p>
          <h2 ref={headingRef} tabIndex={-1} id="case-walkthrough-title">{current.title}</h2>
          <p className="case-walkthrough__copy">{current.explanation}</p>
          <div className="case-walkthrough__actions">
            <button type="button" className="case-walkthrough__secondary" onClick={() => move(-1)} disabled={currentStepIndex === 0}>Back</button>
            <button type="button" onClick={() => move(1)}>{currentStepIndex === steps.length - 1 ? "Finish" : "Next section"}</button>
          </div>
        </aside>
      ), document.body)}
    </>
  );
}
