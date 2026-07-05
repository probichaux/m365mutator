import PagePlaceholder from '../components/PagePlaceholder';

export default function UsersPage() {
  return (
    <PagePlaceholder
      title="Users"
      permission="User.ReadWrite.All"
      operations={[
        'Look up a user by ID or UPN',
        'Update user profile fields',
        'Enable / disable an account',
        'Assign or remove licenses and roles',
      ]}
    />
  );
}
