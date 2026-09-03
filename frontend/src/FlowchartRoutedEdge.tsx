import { BaseEdge, getSmoothStepPath, Position, useNodes, type EdgeProps } from '@xyflow/react';
import { NODE_HEIGHT, NODE_WIDTH, type DiagramEdge, type DiagramNode } from './lib/flowchartLayout';
import { roundedPath, routeLoopBack } from './lib/loopRouting';

export const FlowchartRoutedEdge = (props: EdgeProps<DiagramEdge>) => {
  const nodes = useNodes<DiagramNode>();
  const { sourceX, sourceY, targetX, targetY, data } = props;
  const route = data?.route;
  const first = route?.points[0];
  const last = route?.points.at(-1);
  const unchanged = first && last && Math.hypot(first.x - sourceX, first.y - sourceY) < 1 &&
    Math.hypot(last.x - targetX, last.y - targetY) < 1;

  let [path, labelX, labelY] = getSmoothStepPath(props);
  if (route && unchanged) {
    // Use ELK's actual bend points, not a new path between ELK-positioned nodes.
    path = roundedPath(route.points);
    labelX = route.label?.x ?? labelX;
    labelY = route.label?.y ?? labelY;
  } else if (route?.back) {
    // Dragging keeps connections live, without snapping the moved node back.
    // Re-Layout restores globally optimized routes for the complete graph.
    const bounds = nodes.map((node) => {
      const width = node.measured?.width ?? NODE_WIDTH;
      const height = node.measured?.height ?? NODE_HEIGHT;
      const left = node.position.x - width * (node.origin?.[0] ?? 0);
      const top = node.position.y - height * (node.origin?.[1] ?? 0);
      return { left, right: left + width, top, bottom: top + height };
    }).filter((node) => node.bottom >= Math.min(sourceY, targetY) - 24 &&
      node.top <= Math.max(sourceY, targetY) + 24);
    const moved = routeLoopBack({
      source: { x: sourceX, y: sourceY }, target: { x: targetX, y: targetY }, bounds,
      lane: data?.loop?.lane ?? 0, fromLeft: props.sourcePosition === Position.Left,
    });
    path = moved.path;
    labelX = moved.labelX;
    labelY = moved.labelY;
  }

  return <BaseEdge
    id={props.id}
    path={path}
    markerEnd={props.markerEnd}
    style={props.style}
    interactionWidth={props.interactionWidth}
    label={props.label}
    labelX={labelX}
    labelY={labelY}
    labelStyle={{ fill: '#475569', fontSize: 11 }}
    labelShowBg
    labelBgStyle={{ fill: 'white', fillOpacity: 0.95 }}
    labelBgPadding={[4, 2]}
    labelBgBorderRadius={3}
  />;
};
