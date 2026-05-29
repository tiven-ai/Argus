import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] leading-4 font-normal tabular',
  {
    variants: {
      variant: {
        // "default" = success/active style (most badges in the app are OK status)
        default: 'bg-tint-success text-success',
        secondary: 'bg-tile text-text-3',
        destructive: 'bg-tint-danger text-danger',
        brand: 'bg-tint-brand text-brand',
        warning: 'bg-tint-warning text-warning',
        outline: 'border border-hairline text-text-2',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
