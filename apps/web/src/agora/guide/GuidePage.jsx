/**
 * Agora: the guide, at /guide.
 *
 * A short page that explains what Agora can do, for new members and testers.
 * It only describes what is really built. Parts that still wait for a key or
 * an account say "Coming soon". Opening the page ticks "Read the guide" in the
 * welcome steps (see WelcomeSteps.jsx).
 */
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { Link } from 'react-router-dom'
import { BellIcon, BookOpen, BookUser, CalendarDays, FolderOpen, LifeBuoy, MessageSquare, ScrollText, Sparkles, UserRound, Users } from 'lucide-react'
import { useViewHeader } from 'contexts/ViewHeaderContext'
import useAgoraSeen, { GUIDE_READ } from './useAgoraSeen'
import useMyCircle from './useMyCircle'

function ComingSoon ({ children }) {
  const { t } = useTranslation()
  return (
    <p className='rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground' data-testid='guide-coming-soon'>
      <span className='font-semibold'>{t('Coming soon')}:</span> {children}
    </p>
  )
}

function Section ({ id, icon: Icon, title, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className='bg-card border border-border rounded-lg p-4 flex flex-col gap-2 scroll-mt-4' data-testid='guide-section'>
      <h2 id={`${id}-title`} className='flex items-center gap-2 text-lg font-semibold text-foreground'>
        <Icon className='w-5 h-5 shrink-0 text-accent' aria-hidden='true' /> {title}
      </h2>
      <div className='flex flex-col gap-2 text-foreground/90 leading-relaxed'>{children}</div>
    </section>
  )
}

function GoTo ({ to, children }) {
  return <Link to={to} className='self-start text-sm font-medium text-accent hover:underline'>{children}</Link>
}

export default function GuidePage () {
  const { t } = useTranslation()
  const { me, markSeen } = useAgoraSeen()
  const circle = useMyCircle()

  const { setHeaderDetails } = useViewHeader()
  useEffect(() => {
    setHeaderDetails({ title: t('Agora guide'), icon: <BookOpen />, info: '', search: false })
  }, [setHeaderDetails, t])

  // Opening the guide counts as reading it, for the welcome steps
  const meId = me && me.id
  useEffect(() => { if (meId) markSeen(GUIDE_READ) }, [meId]) // eslint-disable-line react-hooks/exhaustive-deps

  const sections = [
    { id: 'what', icon: Sparkles, title: t('What Agora is') },
    { id: 'circles', icon: Users, title: t('Circles') },
    { id: 'posts', icon: MessageSquare, title: t('Posts, discussions and proposals') },
    { id: 'events', icon: CalendarDays, title: t('Events and meetings') },
    { id: 'files', icon: FolderOpen, title: t('Files') },
    { id: 'playbook', icon: BookOpen, title: t('Playbook') },
    { id: 'contacts', icon: BookUser, title: t('Contacts') },
    { id: 'notifications', icon: BellIcon, title: t('Notifications and email') },
    { id: 'profile', icon: UserRound, title: t('Your profile') },
    { id: 'help', icon: LifeBuoy, title: t('Getting help') },
    { id: 'rules', icon: ScrollText, title: t('Rules and privacy') }
  ]
  const title = id => sections.find(s => s.id === id).title
  const icon = id => sections.find(s => s.id === id).icon

  return (
    <div className='p-4 w-full max-w-[750px] mx-auto flex flex-col gap-4'>
      <Helmet>
        <title>{t('Agora guide')} | Agora</title>
      </Helmet>

      <p className='text-foreground/80'>{t('A short tour of what you can do in Agora. Each part takes a minute to read.')}</p>

      <nav aria-label={t('On this page')} className='flex flex-wrap gap-2'>
        {sections.map(s => (
          <a key={s.id} href={`#${s.id}`} className='rounded-full border border-border bg-card px-3 py-1 text-sm text-foreground hover:border-selected'>
            {s.title}
          </a>
        ))}
      </nav>

      <Section id='what' icon={icon('what')} title={title('what')}>
        <p>{t('Agora is the online home of 7 Billion Presidents (7BP). The circles, the people, the meetings, the decisions and the files of 7BP come together here.')}</p>
        <p>{t('Agora is built on Hylo, an open source platform for communities. It has no ads and no tracking.')}</p>
      </Section>

      <Section id='circles' icon={icon('circles')} title={title('circles')}>
        <p>{t('7BP works in circles: small teams with their own task, such as governance or communications. Each circle has its own place in Agora with its posts, chat, events and members.')}</p>
        <p>{t('Agora is by invitation. A steward of a circle invites you by email or sends you the join link of the circle. You can be in several circles. Your circles are in the bar on the left.')}</p>
        <p>{t('Stewards invite new people in the settings of their circle, under Invite.')}</p>
        {circle
          ? <GoTo to={`/groups/${circle.slug}`}>{t('Open {{name}}', { name: circle.name })}</GoTo>
          : <GoTo to='/my/groups'>{t('See my circles')}</GoTo>}
      </Section>

      <Section id='posts' icon={icon('posts')} title={title('posts')}>
        <p>{t('In a circle you can chat, and you can write posts. Use the plus button in the bar on the left to make one.')}</p>
        <ul className='list-disc pl-5 flex flex-col gap-1'>
          <li>{t('A discussion is for sharing news or talking something through. Others reply in the comments.')}</li>
          <li>{t('A proposal asks the circle to decide. Members vote on the options, and the outcome stays on the post. The Proposals view of a circle shows what it is deciding.')}</li>
          <li>{t('There are also requests, offers, projects and resources, for asking for help, offering it and sharing useful things.')}</li>
        </ul>
        <p>{t('Mention someone with @ and their name to let them know.')}</p>
      </Section>

      <Section id='events' icon={icon('events')} title={title('events')}>
        <p>{t('An event is a post with a date and time. When you make one, you can invite people. They get a notification and answer Going, Interested or Not going. The Events view of a circle lists what is coming up.')}</p>
        <p>{t('Every event has its own meeting room in Agora, and the call takes place there. Open the event and click "Meet in Agora, with minutes". Headphones help.')}</p>
        <p>{t('When you come in, the room asks if your voice may be part of the notes. Say no, or pause at any time, and your voice stays out of them. After the meeting, Agora posts the transcript and a short summary with decisions and actions in the circle. Nobody has to take notes.')}</p>
        <ComingSoon>{t('A guest link, so people from outside Agora can join a meeting.')}</ComingSoon>
      </Section>

      <Section id='files' icon={icon('files')} title={title('files')}>
        <p>{t('Each circle will get a Files page that shows its folder in 7BP\'s Google Drive. Files open in Drive, and members of the circle can add files and folders, also big videos.')}</p>
        <ComingSoon>{t('The Google Drive of 7BP is not connected to Agora yet. Until then, keep using Drive as you do now.')}</ComingSoon>
      </Section>

      <Section id='playbook' icon={icon('playbook')} title={title('playbook')}>
        <p>{t('The playbook is how 7BP works, written down chapter by chapter: onboarding, governance, communications and more. The Playbook page of a circle shows every chapter with its owner, its status (not started, draft, in review or agreed) and a link to the text.')}</p>
        <p>{t('Members read it. Stewards add and change chapters. A chapter is usually agreed through a proposal first.')}</p>
        <p>{t('You find it in the menu of a circle, under Playbook, once the circle has chapters.')}</p>
        {circle && <GoTo to={`/groups/${circle.slug}/playbook`}>{t('Open the playbook of {{name}}', { name: circle.name })}</GoTo>}
      </Section>

      <Section id='contacts' icon={icon('contacts')} title={title('contacts')}>
        <p>{t('The Contacts page is one shared list of the people and organisations 7BP works with outside Agora: partners, press, funders and people who are interested. Each contact has notes and follow-ups, a next step with a date and a person. The number on the Contacts button in the bar on the left is how many of your follow-ups are due.')}</p>
        <p>{t('Every member can read and change it, and every change is logged.')}</p>
        <p className='font-medium'>{t('Please do not put real people\'s details in yet. That waits until 7BP has agreed how it looks after personal data.')}</p>
        <GoTo to='/contacts'>{t('Open Contacts')}</GoTo>
      </Section>

      <Section id='notifications' icon={icon('notifications')} title={title('notifications')}>
        <p>{t('The bell in the bar on the left shows what happened for you: replies, mentions, invitations and new posts in your circles. Messages, the speech bubble, are private chats with one or more people.')}</p>
        <p>{t('You choose what reaches you and how often, per circle: every post, only important ones, or nothing. You can also get an email digest, a summary of new posts once a day or once a week.')}</p>
        <GoTo to='/my/notifications'>{t('Choose my notifications')}</GoTo>
        <ComingSoon>{t('Emails from Agora. Agora\'s own mailbox is being set up. Until then, look at the bell.')}</ComingSoon>
      </Section>

      <Section id='profile' icon={icon('profile')} title={title('profile')}>
        <p>{t('Your profile tells others who you are: a photo, a line about yourself, your skills and how to reach you. It helps people in other circles find you when they need what you know.')}</p>
        <GoTo to='/my/edit-profile'>{t('Fill in my profile')}</GoTo>
      </Section>

      <Section id='help' icon={icon('help')} title={title('help')}>
        <p>{t('Stuck, found something that does not work, or have a wish? Click Help at the bottom right of any page and tell it in your own words. Your request goes to the Help desk team, and their answers come back in the Help window, under My requests.')}</p>
        <p>{t('You can also ask in your circle, or send a message to a steward.')}</p>
        <p>{t('You can open this guide again at any time from the question mark or the gear in the bar on the left.')}</p>
      </Section>

      <Section id='rules' icon={icon('rules')} title={title('rules')}>
        <p>{t('The Terms of use say how we use Agora together. The Privacy notice says what Agora keeps about you, why, and what you can ask for. Both are drafts until 7BP approves them.')}</p>
        <div className='flex flex-wrap gap-4'>
          <GoTo to='/terms'>{t('Terms of Service')}</GoTo>
          <GoTo to='/privacy'>{t('Privacy Policy')}</GoTo>
        </div>
      </Section>
    </div>
  )
}
