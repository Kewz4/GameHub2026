import "./styles.scss";

import { XIcon } from "@phosphor-icons/react";
import cn from "classnames";
import type { HTMLAttributes, ReactNode } from "react";
import { Typography } from "../typography";

export interface EmptyStateProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  illustration?: ReactNode;
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export function EmptyState({
  illustration,
  icon,
  title,
  description,
  actions,
  children,
  className,
  role = "status",
  ...props
}: Readonly<EmptyStateProps>) {
  const resolvedIcon = icon ?? <XIcon size={32} weight="bold" />;
  const resolvedActions = actions ?? children;

  return (
    <div
      className={cn("empty-state", className)}
      role={role}
      data-empty-state
      {...props}
    >
      <div className="empty-state__visual" aria-hidden="true">
        {illustration ? (
          <div className="empty-state__illustration">{illustration}</div>
        ) : null}
        <div className="empty-state__icon">{resolvedIcon}</div>
      </div>

      <div className="empty-state__copy">
        {title ? (
          <Typography variant="h2" className="empty-state__title">
            {title}
          </Typography>
        ) : null}
        {description ? (
          <Typography className="empty-state__description">
            {description}
          </Typography>
        ) : null}
      </div>

      {resolvedActions ? (
        <div className="empty-state__actions">{resolvedActions}</div>
      ) : null}
    </div>
  );
}
