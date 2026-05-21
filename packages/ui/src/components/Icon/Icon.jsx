/**
 * Wrapper de lucide-react con tamaños consistentes y `currentColor`.
 * Uso: <Icon name="Play" size={20} />  /  <Icon name="Heart" filled />
 *
 * No incluye TODOS los íconos de Lucide para evitar bundle bloat — solo los
 * que la app usa. Si añades un ícono nuevo, regístralo en ICONS abajo.
 */
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Plus, MoreHorizontal, MoreVertical,
  Volume2, VolumeX, ListMusic, Menu,
  Home, Library, ArrowDownToLine, Download, Upload,
  Search, SearchX, X, Check, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  ArrowLeft,
  Info, Trash2, Pencil, Music, Music2,
  AlertTriangle, AlertCircle, Loader2, CheckCircle2, Circle, Clock,
  CornerDownRight, Share2, Send, Settings, LogOut, User,
  Users, UserPlus, UserCheck, UserMinus, UserX,
  Headphones, Inbox, FolderPlus,
  MessageCircle, Bell, BellOff, Sparkles, Flame,
  Wifi, WifiOff, Cloud, CloudOff, Cast, Disc3,
  Sun, Moon, Monitor,
  ExternalLink,
} from 'lucide-react';

const ICONS = {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Plus, MoreHorizontal, MoreVertical,
  Volume2, VolumeX, ListMusic, Menu,
  Home, Library, ArrowDownToLine, Download, Upload,
  Search, SearchX, X, Check, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  ArrowLeft,
  Info, Trash2, Pencil, Music, Music2,
  AlertTriangle, AlertCircle,
  // Loader es un alias a Loader2 — el codigo usa "Loader" en algunas vistas
  Loader2, Loader: Loader2,
  CheckCircle2, Circle, Clock,
  CornerDownRight, Share2, Send, Settings, LogOut, User,
  Users, UserPlus, UserCheck, UserMinus, UserX,
  Headphones, Inbox, FolderPlus,
  MessageCircle, Bell, BellOff, Sparkles, Flame,
  Wifi, WifiOff, Cloud, CloudOff, Cast, Disc3,
  Sun, Moon, Monitor,
  ExternalLink,
};

/**
 * @param {{
 *   name: keyof typeof ICONS,
 *   size?: number,
 *   strokeWidth?: number,
 *   filled?: boolean,
 *   className?: string,
 *   'aria-hidden'?: boolean,
 * }} props
 */
export function Icon({ name, size = 20, strokeWidth = 2, filled = false, className, ...rest }) {
  const Cmp = ICONS[name];
  if (!Cmp) {
    if (typeof console !== 'undefined') console.warn(`[Icon] unknown icon "${name}"`);
    return null;
  }
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden={rest['aria-hidden'] ?? true}
    />
  );
}
