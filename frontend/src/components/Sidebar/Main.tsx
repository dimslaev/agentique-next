import { Link as RouterLink, useRouterState } from "@tanstack/react-router"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

export type Item = {
  index: string
  title: string
  path: string
}

interface MainProps {
  items: Item[]
}

export function Main({ items }: MainProps) {
  const { isMobile, setOpenMobile } = useSidebar()
  const router = useRouterState()
  const currentPath = router.location.pathname

  const handleMenuClick = () => {
    if (isMobile) setOpenMobile(false)
  }

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive = currentPath === item.path

            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={isActive}
                  asChild
                >
                  <RouterLink to={item.path} onClick={handleMenuClick}>
                    <span
                      className={cn(
                        "flex h-[18px] w-[18px] shrink-0 items-center justify-center border font-mono text-[10px] leading-none tabular-nums transition-colors duration-200",
                        isActive
                          ? "border-foreground bg-foreground text-background"
                          : "border-border/60 text-muted-foreground group-hover/menu-button:border-foreground group-hover/menu-button:text-foreground",
                      )}
                    >
                      {item.index}
                    </span>
                    <span>{item.title}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
