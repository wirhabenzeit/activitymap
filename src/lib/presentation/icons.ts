import {
  ArrowLeft,
  Calendar,
  Download,
  Expand,
  Flame,
  Gauge,
  Heart,
  Locate,
  MapPin,
  Mountain,
  Ruler,
  Square,
  Timer,
  X,
  Zap,
} from 'lucide-react';

import {
  type ActionID,
  type MetricID,
  presentation,
} from './catalog.generated';
import { message } from './messages';

const glyphs = {
  ArrowLeft,
  X,
  Expand,
  MapPin,
  Square,
  Locate,
  Download,
  Ruler,
  Timer,
  Mountain,
  Calendar,
  Gauge,
  Zap,
  Heart,
  Flame,
};
export function semanticAction(id: ActionID) {
  const definition = presentation.actions[id];
  return {
    ...definition,
    label: message(definition.message),
    Icon: glyphs[definition.webGlyph],
  };
}
export function semanticMetric(id: MetricID) {
  const definition = presentation.metrics[id];
  return {
    ...definition,
    label: message(definition.message),
    Icon: glyphs[definition.webGlyph],
  };
}
