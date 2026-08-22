import { Link } from "react-router-dom";
import { ArrowUpRight, ShieldCheck } from "lucide-react";

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuPopup,
  NavigationMenuPositioner,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle
} from "@/components/ui/navigation-menu-1";
import { OFFERINGS } from "@/lib/offerings";

/**
 * Header navigation, generated from `OFFERINGS` so it cannot drift from the
 * home page.
 *
 * The panel is a plain responsive grid. An earlier version used the upstream
 * demo's `row-span-3` featured tile, which assumed exactly three items — once
 * there were five tools the rows overlapped and the overlapping elements
 * swallowed clicks, so links appeared to do nothing. A flat grid has no such
 * coupling to the number of items.
 */
export function ProductsMenu() {
  return (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Tools</NavigationMenuTrigger>
          <NavigationMenuContent>
            {/* Width is capped against the viewport so the panel can never
                overflow on a narrow window. */}
            <div className="w-[min(88vw,540px)]">
              <ul className="grid gap-1 sm:grid-cols-2">
                {OFFERINGS.map((offering) => (
                  <li key={offering.name}>
                    <NavigationMenuLink
                      className="h-full gap-1 rounded-lg p-3"
                      render={<Link to={offering.path} />}
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold leading-none">
                        <offering.icon className="shrink-0 text-signal-soft" />
                        <span className="truncate">{offering.name}</span>
                      </div>
                      <p className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">
                        {offering.tagline}
                      </p>
                    </NavigationMenuLink>
                  </li>
                ))}
              </ul>

              <div className="mt-1 border-t border-border pt-1">
                <NavigationMenuLink
                  className="flex-row items-center gap-2 rounded-lg p-3"
                  render={<Link to="/signup" />}
                >
                  <ShieldCheck className="shrink-0 text-signal-soft" />
                  <span className="flex-1 text-sm">Create an account — paper only, nothing leaves this browser</span>
                  <ArrowUpRight className="shrink-0 text-muted-foreground" />
                </NavigationMenuLink>
              </div>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuLink className={navigationMenuTriggerStyle()} render={<Link to="/journal" />}>
            Guide
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>

      <NavigationMenuPositioner>
        <NavigationMenuPopup />
      </NavigationMenuPositioner>
    </NavigationMenu>
  );
}
