import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Wallet, HardHat, Settings as Cog, Globe, Moon, Sun,
  LogOut, ChevronDown, Home, Menu, X, PiggyBank, Coins,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

const navItems = [
  { to: "/", key: "nav_dashboard", icon: LayoutDashboard, end: true },
  { to: "/inkomsten", key: "nav_income", icon: Wallet },
  { to: "/bouwdepot", key: "nav_bouwdepot", icon: HardHat },
  { to: "/doelen", key: "nav_goals", icon: PiggyBank },
  { to: "/instellingen", key: "nav_settings", icon: Cog },
];

export default function Header() {
  const { t, lang, setLang, theme, setTheme, user, logout, households, currentHousehold, setCurrentId } =
    useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const doLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <header className="backdrop-blur-md bg-white/80 dark:bg-slate-950/80 border-b border-slate-200/80 dark:border-slate-800/80 sticky top-0 z-50">
      <div className="flex items-center justify-between h-16 px-4 sm:px-8 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 font-heading font-extrabold text-lg tracking-tight">
            <span className="grid place-items-center h-8 w-8 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900">
              <Home className="h-4 w-4" />
            </span>
            <span className="hidden sm:inline">Bouwdepot</span>
          </div>
          <nav className="hidden md:flex items-center gap-1" data-testid="main-navigation-header">
            {navItems.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                data-testid={`nav-${n.key}`}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                    isActive
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`
                }
              >
                <n.icon className="h-4 w-4" />
                {t(n.key)}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {households.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1 max-w-[160px]" data-testid="household-switcher">
                  <span className="truncate">{currentHousehold?.name || t("no_household")}</span>
                  <ChevronDown className="h-4 w-4 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover">
                <DropdownMenuLabel>{t("switch_household")}</DropdownMenuLabel>
                {households.map((h) => (
                  <DropdownMenuItem
                    key={h.household_id}
                    data-testid={`hh-option-${h.household_id}`}
                    onClick={() => setCurrentId(h.household_id)}
                  >
                    {h.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            variant="ghost" size="icon" aria-label="language"
            data-testid="language-toggle"
            onClick={() => setLang(lang === "nl" ? "en" : "nl")}
            className="gap-1 w-auto px-2"
          >
            <Globe className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase">{lang}</span>
          </Button>

          <Button
            variant="ghost" size="icon" aria-label="theme"
            data-testid="theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="user-menu" className="rounded-full">
                {user?.picture ? (
                  <img src={user.picture} alt="" className="h-7 w-7 rounded-full" />
                ) : (
                  <span className="h-7 w-7 grid place-items-center rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-bold">
                    {(user?.name || user?.email || "?")[0].toUpperCase()}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              <DropdownMenuLabel className="truncate max-w-[200px]">{user?.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={doLogout} data-testid="logout-btn">
                <LogOut className="h-4 w-4 mr-2" /> {t("logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(!open)} data-testid="mobile-menu-toggle">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>
      {open && (
        <nav className="md:hidden border-t border-border px-4 py-2 flex flex-col gap-1 bg-white dark:bg-slate-950">
          {navItems.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={() => setOpen(false)}
              data-testid={`mnav-${n.key}`}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                  isActive ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300"
                }`
              }
            >
              <n.icon className="h-4 w-4" />
              {t(n.key)}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}
