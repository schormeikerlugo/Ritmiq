/**
 * Wrapper de lucide-react con tamaños consistentes y `currentColor`.
 *
 * Uso:
 *   <Icon name="Play" size={20} />     <- numerico (back-compat)
 *   <Icon name="Play" size="md" />     <- keyword (recomendado)
 *   <Icon name="Heart" filled />
 *
 * Escala oficial (sizes semanticos):
 *   xs  = 12px  -> chips, badges, inline hints
 *   sm  = 14px  -> list row icons, small inline
 *   md  = 16px  -> DEFAULT, botones primary, controles compactos
 *   lg  = 20px  -> TopBar, NowPlaying, controles principales
 *   xl  = 24px  -> hero icons, action buttons grandes
 *   2xl = 32px  -> empty states, illustrations
 *   3xl = 48px  -> hero illustrations
 *
 * NO incluye TODOS los iconos de Lucide para evitar bundle bloat — solo
 * los que la app usa. Si añades uno nuevo, registralo en ICONS abajo.
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
  CornerDownRight, Share2, Send, Settings, LogOut, LogIn, User,
  Users, UserPlus, UserCheck, UserMinus, UserX,
  Headphones, Inbox, FolderPlus,
  MessageCircle, Bell, BellOff, Sparkles, Flame, BadgeCheck,
  Wifi, WifiOff, Cloud, CloudOff, Cast, Disc3,
  Sun, Moon, Monitor,
  ExternalLink,
  Eye, EyeOff, Mail, Lock, AtSign,
  Radio, Crown, Copy,
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
  CornerDownRight, Share2, Send, Settings, LogOut, LogIn, User,
  Users, UserPlus, UserCheck, UserMinus, UserX,
  Headphones, Inbox, FolderPlus,
  MessageCircle, Bell, BellOff, Sparkles, Flame, BadgeCheck,
  Wifi, WifiOff, Cloud, CloudOff, Cast, Disc3,
  Sun, Moon, Monitor,
  ExternalLink,
  Eye, EyeOff, Mail, Lock, AtSign,
  Radio, Crown, Copy,
};

/**
 * Escala oficial de tamaños. Cualquier valor numerico tambien funciona
 * (back-compat con codigo legacy que paso 18, 22, 26, etc.).
 */
const SIZE_MAP = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
};

function resolveSize(size) {
  if (typeof size === 'number') return size;
  if (typeof size === 'string' && SIZE_MAP[size] != null) return SIZE_MAP[size];
  // fallback default
  return 20;
}

/**
 * @param {{
 *   name: keyof typeof ICONS,
 *   size?: number | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl',
 *   strokeWidth?: number,
 *   filled?: boolean,
 *   className?: string,
 *   'aria-hidden'?: boolean,
 * }} props
 */
export function Icon({ name, size = 'lg', strokeWidth = 2, filled = false, className, ...rest }) {
  const Cmp = ICONS[name];
  if (!Cmp) {
    if (typeof console !== 'undefined') console.warn(`[Icon] unknown icon "${name}"`);
    return null;
  }
  return (
    <Cmp
      size={resolveSize(size)}
      strokeWidth={strokeWidth}
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden={rest['aria-hidden'] ?? true}
    />
  );
}
