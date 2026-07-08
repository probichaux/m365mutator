# mod04-calendar

## user interface

The user interface is identical to the user interface for the Mail tab.

## business logic

### implementation

When the user selects the "calendar" module for mutation, it may perform the following basic operations:

1. (50% probability) Create a new meeting request from one user in the selected user set to another. The subject line will be randomly generated text. the message body will be empty. The start time will be a randomly selected weekday during the sending user's calendar working hours. The duration will be 30 minutes.

2. (50% probability) Create a new appointment for one user in the selected user set. The subject line will be randomly generated text. the message body will be empty. The start time will be a randomly selected weekday during the sending user's calendar working hours. The duration will be 30 minutes.


### Notes

* The "selected user set" refers to the set of users that are in scope for the operation, whether they are taken from the list or as a random selection.
* if the user has specified an OpenRouter API key, attempt to use the OpenRouter API to generate any item marked as "randomly generated text." If there is no OpenRouter key, or the OpenRouter call fails, generate a random GUID, convert it to text, and use that instead.
* the prompt for random text generation for subject lines should be "Generate a one-sentence subject line in English related to software-as-a-service applications, airline travel, or the World Cup."



