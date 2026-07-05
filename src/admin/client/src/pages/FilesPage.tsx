import PagePlaceholder from '../components/PagePlaceholder';

export default function FilesPage() {
  return (
    <PagePlaceholder
      title="Files"
      permission="Files.ReadWrite.All, Sites.ReadWrite.All"
      operations={[
        'Upload a document to a user’s OneDrive',
        'Upload a document to a SharePoint site library',
        'Modify document metadata',
        'Remove a document from OneDrive or SharePoint',
      ]}
    />
  );
}
