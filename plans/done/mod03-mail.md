# mod03-mail

## user interface

1. Add a new item to the settings flyway called "OpenRouter API key". It should accept an OpenRouter API key.


## business logic

### implementation

When the user selects the "mail" module for mutation, it may perform the following basic operations:

1. (30% probability) Create a new message from one user in the selected user set to another. The subject line will be randomly generated text. The message body will be randomly generated text. The message will not have any attachments.

2. (35% probability) Select a random message in one user's Inbox folder and reply to it. The reply body will be a single randomly-generated paragraph.

3. (30% probability) Select a random message in one user's Inbox folder and forward it to another randomly selected user from the selected user set. The message will be forwarded with no modifications.

4. (5% probability) Choose a message at random from one selected user and move it to the Deleted Items folder.

### Notes

* The "selected user set" refers to the set of users that are in scope for the operation, whether they are taken from the list or as a random selection.
* if the user has specified an OpenRouter API key, attempt to use the OpenRouter API to generate any item marked as "randomly generated text." If there is no OpenRouter key, or the OpenRouter call fails, generate a random GUID, convert it to text, and use that instead.
* the prompt for random text generation for subject lines should be "Generate a one-sentence subject line in English related to software-as-a-service applications, airline travel, or the World Cup."
* the prompt for random text generation for message bodies should be "Generate a one-paragraph text summary of a randomly chosen Microsoft documentation page."


