# the Targets page

The targets page is where the user specifies which users, mailboxes, sites, etc may be modified.

The UI needs to support the following categories:

- Identities
- Mail
- Calendar
- OneDrive
- SharePoint

The user should be able to enable or disable each category independently.

Within each category, there should be a multi-line text field that goes the full width of the page where the user can enter a list of objects. Each should have a button labeled "..." that allows the user to select a CSV file to upload; its contents will be read and placed into the text field. For the identities, mail, calendar, and onedrive fields, the objects must be UPNs. for the SharePoint field, the objects must be URLs but may omit the http/https prefix. 

Each area should have a button with a "check" icon. When clicked, the button should attempt to resolve each of the objects in the field by checking for its existence against Microsoft Graph. Any items that fail the check should be marked with a red "X" icon to the left of the item.