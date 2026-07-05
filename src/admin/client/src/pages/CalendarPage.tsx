import PagePlaceholder from '../components/PagePlaceholder';

export default function CalendarPage() {
  return (
    <PagePlaceholder
      title="Calendar"
      permission="Calendars.ReadWrite"
      operations={[
        'Create a calendar event with attendees',
        'Update an existing event',
        'Cancel / delete an event',
      ]}
    />
  );
}
