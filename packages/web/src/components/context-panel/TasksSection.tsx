import type { Task } from '../../types';
import {
  formatDate,
  getTaskPriorityClass,
  getTaskStatusIcon,
} from '../../utils/contextPanel';
import { ContextPanelSectionFrame } from './ContextPanelSectionFrame';
import type { ContextSection } from './contextPanelTypes';

interface TasksSectionProps {
  tasks: Task[];
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
}

export function TasksSection({ tasks, expandedSection, onToggleSection }: Readonly<TasksSectionProps>) {
  return (
    <ContextPanelSectionFrame
      section="tasks"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={<span><i className="codicon codicon-checklist" /> Tasks</span>}
      count={tasks.length}
    >
      {tasks.length === 0 ? (
        <div className="context-empty">No tasks assigned yet.</div>
      ) : (
        <div className="context-items">
          {tasks.map((task) => (
            <div key={task.id} className={`context-item context-task ${getTaskPriorityClass(task.priority)}`}>
              <div className="context-item-header">
                <i className={`codicon codicon-${getTaskStatusIcon(task.status)} context-item-pin task-status-icon`} />
                <span className="context-item-title">{task.title}</span>
              </div>
              <div className="context-item-meta">
                <span className="task-priority">{task.priority}</span>
                {task.dueDate ? <span className="task-due-date">Due {formatDate(task.dueDate)}</span> : null}
              </div>
              {task.subtaskIds && task.subtaskIds.length > 0 ? (
                <div className="task-subtasks">
                  {task.subtaskIds.length} subtask{task.subtaskIds.length > 1 ? 's' : ''}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </ContextPanelSectionFrame>
  );
}
