/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { NavLink } from '@/components/ui/nav-link'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { CheckSquare, MessageCirclePlus, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type NavigationMenuProps = {
  isMobile: boolean
  currentPath: string
  showTasks: boolean
  onCreateNewChat: () => void
  onSettingsClick: () => void
}

export const NavigationMenu = ({
  isMobile,
  currentPath,
  showTasks,
  onCreateNewChat,
  onSettingsClick,
}: NavigationMenuProps) => {
  const { t } = useTranslation('chat')

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={onCreateNewChat}
          tooltip={t('nav.newChat')}
          className="cursor-pointer"
          isActive={currentPath === '/chats/new'}
        >
          <MessageCirclePlus className="size-[var(--icon-size-default)]" />
          <span>{t('nav.newChat')}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {showTasks && (
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip={t('nav.tasks')} isActive={currentPath.startsWith('/tasks')}>
            <NavLink to="/tasks">
              <CheckSquare className="size-[var(--icon-size-default)]" />
              <span>{t('nav.tasks')}</span>
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
      <SidebarMenuItem>
        {isMobile ? (
          <SidebarMenuButton
            onClick={onSettingsClick}
            isActive={currentPath.startsWith('/settings')}
            className="cursor-pointer"
          >
            <Settings className="size-[var(--icon-size-default)]" />
            <span>{t('nav.settings')}</span>
          </SidebarMenuButton>
        ) : (
          <SidebarMenuButton asChild tooltip={t('nav.settings')} isActive={currentPath.startsWith('/settings')}>
            <NavLink to="/settings/preferences">
              <Settings className="size-[var(--icon-size-default)]" />
              <span>{t('nav.settings')}</span>
            </NavLink>
          </SidebarMenuButton>
        )}
      </SidebarMenuItem>
    </>
  )
}
