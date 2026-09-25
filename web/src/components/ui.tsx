import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from "react";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const buttonVariants = {
  primary: "button button-primary",
  secondary: "button button-secondary",
  quiet: "button button-quiet",
  danger: "button button-danger",
} as const;

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants }) {
  return <button {...props} type={type} className={classes(buttonVariants[variant], className)} />;
}

export const linkButtonClass = {
  primary: buttonVariants.primary,
  secondary: buttonVariants.secondary,
  quiet: buttonVariants.quiet,
} as const;

export function Field({
  label,
  hint,
  error,
  className = "",
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return <div className={classes("field", className)}>
    <div className="field-label">{label}</div>
    {hint && <p className="field-hint">{hint}</p>}
    <div className="field-control">{children}</div>
    {error && <p className="field-error">{error}</p>}
  </div>;
}

export function ChoiceChip({
  selected = false,
  className = "",
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { selected?: boolean }) {
  return <label {...props} data-selected={selected || undefined} className={classes("choice-chip", className)} />;
}

export function StatusBadge({
  tone = "neutral",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "progress" | "waiting" | "success" | "danger" }) {
  return <span {...props} data-tone={tone} className={classes("status-badge", className)} />;
}

export function Callout({
  tone = "neutral",
  className = "",
  role,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: "neutral" | "waiting" | "success" | "danger" }) {
  return <div {...props} role={role ?? (tone === "danger" ? "alert" : undefined)} data-tone={tone} className={classes("callout", className)} />;
}
