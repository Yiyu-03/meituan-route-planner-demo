import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentQuestion } from './AgentQuestion'
import type { QuestionState } from '../hooks/usePlanStream'

const question: QuestionState = {
  conversationId: 'conv-demo-1',
  question: '海淀的公园里，你更想要哪种？',
  options: ['带娃游乐设施', '安静自然散步', '有湖景拍照'],
}

describe('AgentQuestion', () => {
  it('renders the question text and option buttons', () => {
    const { getByText, getByRole } = render(<AgentQuestion question={question} onAnswer={() => {}} />)
    expect(getByText('海淀的公园里，你更想要哪种？')).toBeInTheDocument()
    expect(getByRole('button', { name: '带娃游乐设施' })).toBeInTheDocument()
    expect(getByRole('button', { name: '有湖景拍照' })).toBeInTheDocument()
  })

  it('calls onAnswer with the clicked option', async () => {
    const onAnswer = vi.fn()
    const { getByRole } = render(<AgentQuestion question={question} onAnswer={onAnswer} />)
    await userEvent.click(getByRole('button', { name: '安静自然散步' }))
    expect(onAnswer).toHaveBeenCalledWith('安静自然散步')
  })

  it('calls onAnswer with free-text input', async () => {
    const onAnswer = vi.fn()
    const { getByPlaceholderText, getByRole } = render(<AgentQuestion question={question} onAnswer={onAnswer} />)
    await userEvent.type(getByPlaceholderText(/直接回答/), '想带孩子玩水')
    await userEvent.click(getByRole('button', { name: /回答/ }))
    expect(onAnswer).toHaveBeenCalledWith('想带孩子玩水')
  })

  it('does not submit empty free text', async () => {
    const onAnswer = vi.fn()
    const { getByRole } = render(<AgentQuestion question={question} onAnswer={onAnswer} />)
    await userEvent.click(getByRole('button', { name: /回答/ }))
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('renders without options as just a free-text answer', () => {
    const { queryAllByRole, getByPlaceholderText } = render(
      <AgentQuestion question={{ conversationId: 'c', question: '?' }} onAnswer={() => {}} />,
    )
    expect(getByPlaceholderText(/直接回答/)).toBeInTheDocument()
    // only the submit button, no option buttons
    expect(queryAllByRole('button')).toHaveLength(1)
  })
})
