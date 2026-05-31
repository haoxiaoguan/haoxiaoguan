import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group sonner-toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.sonner-toast]:text-muted-foreground",
          actionButton:
            "group-[.sonner-toast]:bg-primary group-[.sonner-toast]:text-primary-foreground",
          cancelButton:
            "group-[.sonner-toast]:bg-muted group-[.sonner-toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
