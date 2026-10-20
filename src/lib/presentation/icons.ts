import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronUp,
  Download,
  Expand,
  ExternalLink,
  Flame,
  Gauge,
  Heart,
  Locate,
  MapPin,
  Mountain,
  Pencil,
  RefreshCw,
  Ruler,
  Share2,
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
  Pencil,
  Share2,
  ExternalLink,
  RefreshCw,
  ChevronUp,
  ChevronDown,
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
