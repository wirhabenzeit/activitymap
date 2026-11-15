import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Flame,
  Gauge,
  Heart,
  Eye,
  MapPin,
  Mountain,
  Pencil,
  RefreshCw,
  Ruler,
  Scan,
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
  Scan,
  MapPin,
  Square,
  Eye,
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
