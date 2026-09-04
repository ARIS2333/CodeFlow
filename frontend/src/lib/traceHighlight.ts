import { createContext } from 'react';

/**
 * Which nodes the running trace has reached.
 *
 * This travels by context rather than through FlowchartDiagram's `nodes` prop
 * on purpose: changing that prop restarts the measure/ELK layout cycle, and
 * stepping a trace must never move the diagram the student is reading.
 */
export interface TraceHighlight {
  activeNodeId?: string;
  visitedNodeIds?: ReadonlySet<string>;
}

export const TraceHighlightContext = createContext<TraceHighlight>({});
