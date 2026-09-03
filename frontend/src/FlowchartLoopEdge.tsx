import { BaseEdge, Position, useNodes, type EdgeProps } from '@xyflow/react';
import { NODE_HEIGHT, NODE_WIDTH, type DiagramEdge, type DiagramNode } from './lib/flowchartLayout';
import { routeLoopBack, routeLoopExit } from './lib/loopRouting';

const FlowchartLoopEdge = (props: EdgeProps<DiagramEdge> & { returning?: boolean }) => {
  const nodes = useNodes<DiagramNode>();
  const { sourceX, sourceY, targetX, targetY, data, returning } = props;
  const memberIds = new Set(data?.loop?.nodeIds);
  // Read current bounds for routing, including after dragging. This does not
  // change node sizing, the layout's size assumptions, or the viewport policy.
  const bounds = nodes.map((node) => {
    const width = node.measured?.width ?? NODE_WIDTH;
    const height = node.measured?.height ?? NODE_HEIGHT;
    const left = node.position.x - width * (node.origin?.[0] ?? 0);
    const top = node.position.y - height * (node.origin?.[1] ?? 0);
    return { id: node.id, left, right: left + width, top, bottom: top + height };
  }).filter((node) => memberIds.has(node.id) || (
    node.bottom >= Math.min(sourceY, targetY) - 24 &&
    node.top <= Math.max(sourceY, targetY) + 24
  ));
  const route = (returning ? routeLoopBack : routeLoopExit)({
    source: { x: sourceX, y: sourceY },
    target: { x: targetX, y: targetY },
    bounds,
    lane: data?.loop?.lane ?? 0,
    fromLeft: props.sourcePosition === Position.Left,
  });

  return <BaseEdge
    id={props.id}
    path={route.path}
    markerEnd={props.markerEnd}
    style={props.style}
    interactionWidth={props.interactionWidth}
    label={props.label}
    labelX={route.labelX}
    labelY={route.labelY}
    labelStyle={{ fill: '#475569', fontSize: 11 }}
    labelShowBg
    labelBgStyle={{ fill: 'white', fillOpacity: 0.95 }}
    labelBgPadding={[4, 2]}
    labelBgBorderRadius={3}
  />;
};

export const LoopBackEdge = (props: EdgeProps<DiagramEdge>) => <FlowchartLoopEdge {...props} returning />;
export const LoopExitEdge = (props: EdgeProps<DiagramEdge>) => <FlowchartLoopEdge {...props} />;
