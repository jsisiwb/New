/**
 * The operator console (Checkpoint 7).
 *
 * One authenticated page with an explicit work-area switcher rather than eleven routes, because the
 * operator's context — the active workspace and project — is the same across all of them and re-selecting
 * it on every navigation is the friction the UI plan's single project shell exists to avoid.
 *
 * Focus is moved to the `<main>` landmark after a work-area change, which is what makes the switcher
 * usable with a keyboard: without it, focus stays on the tab and the next Tab press walks the nav again
 * instead of entering the content that just appeared.
 */
'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ProtectedRoute, SignOutButton } from '../screens/auth';
import { ProjectOverviewScreen, WorkspaceScreen } from '../screens/workspace';
import { NovelScreen } from '../screens/novel';
import { SpecScreen } from '../screens/spec';
import { DirectionsAndConceptsScreen } from '../screens/concepts';
import { BibleScreen, NarrativeIdentityScreen } from '../screens/bible';
import { PlanningScreen } from '../screens/planning';
import { CandidateReviewScreen, ChaptersScreen } from '../screens/chapters';
import { CanonScreen } from '../screens/canon';
import { OperationsScreen } from '../screens/operations';

export const WORK_AREAS = [
  { id: 'workspace', label: 'Workspace and projects' },
  { id: 'overview', label: 'Project overview' },
  { id: 'novel', label: 'New novel' },
  { id: 'spec', label: 'Specification and assumptions' },
  { id: 'concepts', label: 'Directions and concepts' },
  { id: 'bible', label: 'Bible and register profiles' },
  { id: 'identity', label: 'Narrative identity and terminology' },
  { id: 'planning', label: 'Planning' },
  { id: 'chapters', label: 'Chapters and production' },
  { id: 'review', label: 'Candidate and scorecard review' },
  { id: 'canon', label: 'Canon and change operations' },
  { id: 'operations', label: 'Jobs, costs and export' },
] as const;

export type WorkAreaId = (typeof WORK_AREAS)[number]['id'];

export default function ConsolePage(): ReactNode {
  return (
    <ProtectedRoute>
      <Console />
    </ProtectedRoute>
  );
}

export function Console(): ReactNode {
  const [area, setArea] = useState<WorkAreaId>('workspace');
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [chapterNo, setChapterNo] = useState(1);
  const headingRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  // Predictable focus after navigation: the new work area receives focus, not the control that opened it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [area]);

  const needsProject = area !== 'workspace';

  return (
    <div>
      <nav aria-label="Work areas">
        <ul className="actions">
          {WORK_AREAS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={area === item.id ? 'page' : undefined}
                onClick={() => {
                  setArea(item.id);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
          <li>
            <SignOutButton />
          </li>
        </ul>
      </nav>

      <div ref={headingRef} tabIndex={-1}>
        {needsProject && !projectId ? (
          <p className="note">Select a project from “Workspace and projects” to continue.</p>
        ) : (
          <WorkArea
            area={area}
            projectId={projectId ?? ''}
            chapterNo={chapterNo}
            onOpenProject={(id) => {
              setProjectId(id);
              setArea('overview');
            }}
            onOpenChapter={(n) => {
              setChapterNo(n);
              setArea('review');
            }}
          />
        )}
      </div>
    </div>
  );
}

export function WorkArea({
  area,
  projectId,
  chapterNo,
  onOpenProject,
  onOpenChapter,
}: {
  area: WorkAreaId;
  projectId: string;
  chapterNo: number;
  onOpenProject: (projectId: string) => void;
  onOpenChapter: (chapterNo: number) => void;
}): ReactNode {
  switch (area) {
    case 'workspace':
      return <WorkspaceScreen onOpenProject={onOpenProject} />;
    case 'overview':
      return <ProjectOverviewScreen projectId={projectId} />;
    case 'novel':
      return <NovelScreen projectId={projectId} />;
    case 'spec':
      return <SpecScreen projectId={projectId} />;
    case 'concepts':
      return <DirectionsAndConceptsScreen projectId={projectId} />;
    case 'bible':
      return <BibleScreen projectId={projectId} />;
    case 'identity':
      return <NarrativeIdentityScreen projectId={projectId} />;
    case 'planning':
      return <PlanningScreen projectId={projectId} />;
    case 'chapters':
      return <ChaptersScreen projectId={projectId} onOpenChapter={onOpenChapter} />;
    case 'review':
      return <CandidateReviewScreen projectId={projectId} chapterNo={chapterNo} />;
    case 'canon':
      return <CanonScreen projectId={projectId} />;
    case 'operations':
      return <OperationsScreen projectId={projectId} />;
  }
}
