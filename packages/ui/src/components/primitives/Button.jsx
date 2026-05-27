import { forwardRef } from 'react';
import { Icon } from '../Icon/Icon.jsx';
import styles from './Button.module.css';

/**
 * Boton reutilizable con variants, sizes y loading state integrado.
 *
 * @param {{
 *   variant?: 'primary' | 'ghost' | 'danger' | 'subtle',
 *   size?: 'sm' | 'md' | 'lg',
 *   loading?: boolean,
 *   loadingText?: string,
 *   iconLeft?: string,
 *   iconRight?: string,
 *   fullWidth?: boolean,
 *   children?: React.ReactNode,
 *   className?: string,
 *   type?: 'button' | 'submit' | 'reset',
 * } & React.ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingText,
    iconLeft,
    iconRight,
    fullWidth = false,
    disabled,
    children,
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  const cls = [
    styles.btn,
    styles[`variant_${variant}`],
    styles[`size_${size}`],
    fullWidth && styles.fullWidth,
    loading && styles.isLoading,
    className,
  ].filter(Boolean).join(' ');

  // Icon size mapeado a escala oficial: sm=sm(14), md=md(16), lg=lg(20).
  const iconSize = size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : 'md';

  return (
    <button
      ref={ref}
      type={type}
      className={cls}
      disabled={disabled || loading}
      data-loading={loading || undefined}
      {...rest}
    >
      {loading ? (
        <>
          <Icon name="Loader2" size={iconSize} className={styles.spinner} />
          <span>{loadingText ?? children}</span>
        </>
      ) : (
        <>
          {iconLeft && <Icon name={iconLeft} size={iconSize} />}
          <span>{children}</span>
          {iconRight && <Icon name={iconRight} size={iconSize} />}
        </>
      )}
    </button>
  );
});
