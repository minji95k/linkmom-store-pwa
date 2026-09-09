import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "bg-bg text-text-2",
        purple: "bg-purple-tint text-purple-dark",
        mint: "bg-mint-tint text-mint-dark",
        danger: "bg-danger-tint text-danger",
        warning: "bg-warning-tint text-warning",
        solid: "bg-purple text-white",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
