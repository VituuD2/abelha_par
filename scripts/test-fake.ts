async function run() {
    const response = await fetch('https://api.tiny.com.br/public-api/v3/info', {
      headers: {
        Authorization: `Bearer eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJnWXk2cDhkQkU0dDBkZkFvU0J4WkJvbDBkYmpTcEF5Z3FpQm1vY3pMcXJVIn0.fake_token`,
        "Content-Type": "application/json",
      },
    });

    console.log('Fake token status:', response.status);
    console.log('Fake token body:', await response.text());
}

run();
