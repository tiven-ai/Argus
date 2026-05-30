import * as React from 'react'
import * as Primitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

export const DropdownMenu = Primitive.Root
export const DropdownMenuTrigger = Primitive.Trigger

export function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[12rem] rounded-md border border-hairline bg-popover py-1 u-body text-text-2 shadow-[var(--shadow-popover)]',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  )
}

export function DropdownMenuItem({
  className,
  disabled,
  ...props
}: React.ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      disabled={disabled}
      className={cn(
        'flex cursor-default items-center justify-between px-3 py-1.5 outline-none',
        disabled
          ? 'text-text-4'
          : 'text-text-2 data-[highlighted]:bg-tile data-[highlighted]:text-text-1',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label className={cn('px-3 pb-1 pt-1 u-caption text-text-3', className)} {...props} />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn('my-1 h-px bg-hairline', className)} {...props} />
}
