const axios = require('axios');

const REDDIT_BASE_URL = 'https://www.reddit.com';
const USER_AGENT = 'CompetitorAnalysis/1.0';

const SEARCH_QUERIES = {
  'Medium': ['medium.com', 'medium writing', 'medium platform'],
  'Substack': ['substack', 'substack newsletter', 'substack vs'],
  'Ghost': ['ghost.org', 'ghost platform'],
  'LinkedIn': ['linkedin articles', 'linkedin publishing'],
  'dev.to': ['dev.to', 'devto'],
  'Hashnode': ['hashnode', 'hashnode blog']
};

async function fetchRedditPosts(query, limit = 20) {
  try {
    const response = await axios.get(`${REDDIT_BASE_URL}/search.json`, {
      params: {
        q: query,
        limit: limit,
        sort: 'new',
        t: 'week'
      },
      headers: {
        'User-Agent': USER_AGENT
      }
    });

    return response.data.data.children.map(child => ({
      id: child.data.id,
      title: child.data.title,
      selftext: child.data.selftext,
      subreddit: child.data.subreddit,
      ups: child.data.ups,
      num_comments: child.data.num_comments
    }));
  } catch (error) {
    console.error(`Error fetching Reddit data:`, error.message);
    return [];
  }
}

function analyzeSentiment(text) {
  const positiveWords = ['great', 'amazing', 'love', 'best', 'awesome', 'excellent', 'good', 'better', 'prefer', 'recommend'];
  const negativeWords = ['terrible', 'hate', 'worst', 'bad', 'awful', 'sucks', 'problems', 'issues', 'frustrating'];

  const lowerText = text.toLowerCase();
  const positiveScore = positiveWords.filter(word => lowerText.includes(word)).length;
  const negativeScore = negativeWords.filter(word => lowerText.includes(word)).length;

  const totalWords = positiveScore + negativeScore;
  if (totalWords === 0) return { sentiment: 'neutral', score: 0.5 };

  const score = positiveScore / totalWords;
  return { 
    sentiment: score > 0.6 ? 'positive' : score < 0.4 ? 'negative' : 'neutral', 
    score 
  };
}

function generateInsights(platformData) {
  const insights = [];
  
  const platformMetrics = Object.entries(platformData).map(([platform, posts]) => ({
    platform,
    posts: posts.length,
    sentiment: posts.length > 0 ? posts.reduce((sum, post) => 
      sum + analyzeSentiment(`${post.title} ${post.selftext}`).score, 0) / posts.length : 0.5
  }));

  const topByMentions = platformMetrics.sort((a, b) => b.posts - a.posts)[0];
  if (topByMentions && topByMentions.platform !== 'Medium' && topByMentions.posts > 5) {
    insights.push({
      type: 'threat',
      title: `${topByMentions.platform} has more Reddit discussions than Medium`,
      confidence: Math.min(90, 60 + topByMentions.posts * 2),
      impact: 'high',
      description: `${topByMentions.platform} has ${topByMentions.posts} recent Reddit mentions vs ${platformData.Medium?.length || 0} for Medium`,
      recommendation: `Investigate what's driving ${topByMentions.platform} discussions`
    });
  }

  return insights;
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    console.log('Starting Reddit analysis...');
    const platformData = {};
    
    for (const [platform, queries] of Object.entries(SEARCH_QUERIES)) {
      const allPosts = [];
      
      for (const query of queries.slice(0, 2)) { // Limit to 2 queries per platform for speed
        const posts = await fetchRedditPosts(query, 15);
        allPosts.push(...posts);
        await new Promise(resolve => setTimeout(resolve, 500)); // Short delay
      }
      
      const uniquePosts = allPosts.filter((post, index, self) => 
        index === self.findIndex(p => p.id === post.id)
      );
      
      platformData[platform] = uniquePosts.slice(0, 20);
    }

    const insights = generateInsights(platformData);
    
    const competitors = Object.entries(platformData).map(([platform, posts]) => {
      const avgSentiment = posts.length > 0 ? 
        posts.reduce((sum, post) => sum + analyzeSentiment(`${post.title} ${post.selftext}`).score, 0) / posts.length : 0.5;
      
      return {
        platform,
        mentions: posts.length,
        sentiment: avgSentiment,
        engagement: posts.reduce((sum, post) => sum + post.ups, 0),
        recentPosts: posts.slice(0, 2).map(post => ({
          title: post.title,
          subreddit: post.subreddit,
          ups: post.ups
        }))
      };
    });

    const totalPosts = Object.values(platformData).reduce((sum, posts) => sum + posts.length, 0);

    res.json({
      success: true,
      data: {
        insights,
        competitors,
        totalPosts,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze Reddit data'
    });
  }
}
